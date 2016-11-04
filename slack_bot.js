/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Based on the sample bot from http://howdy.ai/botkit
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

require('dotenv').config();
var Botkit = require('botkit');
var google = require('googleapis');
var calendar = google.calendar('v3');

if (!process.env.SLACKBOT_TOKEN) {
  console.log('Error: Specify token in environment');
  process.exit(1);
}

var controller = Botkit.slackbot({
  debug: true
});

var key = require(process.env.JWT_KEY_FILE);
var jwtClient = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ['https://www.googleapis.com/auth/calendar'],
  null
);
jwtClient.authorize(function (err, tokens) {
  if (err) {
    console.log(err);
    return;
  }
  
  google.options({
    auth: jwtClient
  });
});

controller.spawn({
  token: process.env.SLACKBOT_TOKEN
}).startRTM();


// use existing hello/shutdown commands from Botkit
controller.hears([ 'hello', 'hi' ], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.api.reactions.add({
    timestamp: message.ts,
    channel: message.channel,
    name: 'robot_face',
  }, function(err) {
    if (err) {
      bot.botkit.log('Failed to add emoji reaction :(', err);
    }
  });
});

controller.hears([ 'shutdown', 'goodbye' ], 'direct_message,direct_mention,mention', function(bot, message) {

  bot.startConversation(message, function(err, convo) {

    convo.ask('Are you sure you want me to shutdown?', [
      {
        pattern: bot.utterances.yes,
        callback: function(response, convo) {
          convo.say('Bye!');
          convo.next();
          setTimeout(function() {
            process.exit();
          }, 3000);
        }
      },
      {
        pattern: bot.utterances.no,
        default: true,
        callback: function(response, convo) {
          convo.say('*Phew!*');
          convo.next();
        }
      }
    ]);
  });
});

controller.hears(['are you free?'], 'direct_message,direct_mention,mention', function(bot, message) {
  isOccupied(function(occupied) {
    if (occupied) {
      bot.reply(message, ("Sorry, but I'm currently reserved for " + occupied.summary))
    } else {
      bot.reply(message, "Yes, I'm free.");
    }
  });
});

function isOccupied(callback) {
  // is there an ongoing event?
  
  var today = new Date();
  var morning = new Date(today.setHours(0,0));  // this morning at midnight
  var night = new Date(today.setHours(23,59));
  
  var ongoing = false;
  var ongoingEvent = null;
  
  calendar.events.list({
      calendarId: process.env.CALENDAR_ID,
      timeMin: morning.toISOString(),
      timeMax: night.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    }, function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        return;
      }
      var events = response.items;
      if (events.length == 0) {
        console.log('No upcoming events found.');
        ongoing = false;
      } else {
        console.log('Events for today:');
        for (var i = 0; i < events.length; i++) {
          var event = events[i];
          var start = event.start.dateTime;
          var end = event.end.dateTime;
          console.log('%s - %s: %s', start, end, event.summary);
          
          var now = new Date();          
          if ( now > new Date(Date.parse(start)) && now < new Date(Date.parse(end)) ) {
              ongoing = true;
              ongoingEvent = event;
          }
        }
      }
      
      if (ongoing) {
        callback(ongoingEvent);
        //console.log('%s is ongoing.', ongoingEvent.summary);
      } else {
        callback(null);
        //console.log('Nothing ongoing.');
      }
    });
}