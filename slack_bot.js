/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Based on the sample bot from http://howdy.ai/botkit
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

require('dotenv').config();
var Botkit = require('botkit');
var google = require('googleapis');
var calendar = google.calendar('v3');
var Sugar = require('sugar');
Sugar.extend();

if (!process.env.SLACK_TOKEN) {
  console.log('Error: Specify token in environment');
  process.exit(1);
}

var controller = Botkit.slackbot({
  debug: true
});

var jwtClient = new google.auth.JWT(
  process.env.JWT_CLIENT_EMAIL,
  null,
  process.env.JWT_KEY.replace(/\\n/g,'\n'),
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
  token: process.env.SLACK_TOKEN
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

controller.hears(['are you free?', 'you free?', 'are you available?'], 'direct_message,direct_mention,mention', function(bot, message) {
  isOccupied(function(occupied) {
    if (occupied) {
      bot.reply(message, ("Sorry, but I'm currently reserved for " + occupied.summary))
    } else {
      bot.reply(message, "Yes, I'm free.");
    }
  });
});

controller.hears(['can we use you (.+)', 'can we reserve you (.+)'], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.startConversation(message, function(err, convo) {
    console.log(message.match[1]);
    cleaned_time_range = message.match[1].replace('?', '');
    console.log(cleaned_time_range);
    var range = Date.range(cleaned_time_range);
    
    if (range.start.isValid() && range.end.isValid()) {
      // TODO: check whether room is occupied during that time

      // conversation question to ask for the description of the event
      convo.ask("Sure, what will you be using me for?", function(response, convo) {
        
        bot.api.users.info({user: message.user}, (error, user_response) => {
          var user_name = user_response.user.name;
          var real_name = user_response.user.real_name;
          console.log(user_name, real_name);
          
          var event = {
            'summary': response.text,
            'description': 'Reserved by ' + user_name,
            'start': {
              'dateTime': range.start
            },
            'end': {
              'dateTime': range.end
            }
          }
          console.log(event);
        
          calendar.events.insert({
              calendarId: process.env.CALENDAR_ID,
              auth: jwtClient,
              resource: event
            }, function(err, event) {
              if (err) {
                convo.say('Oops, ran into a calendar problem: ' + err);
                convo.next();
              } else {
                convo.say('Great, you are reserved!');
                convo.say('Here\'s a calendar link: ' + event.htmlLink);
                convo.next();
              }
            });
        });
      });
    } else {
      convo.say('Oops, I do not understand that timing: ' + range.start + ' -- ' + range.end);
      convo.next();
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
      auth: jwtClient,
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
