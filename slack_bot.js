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

// friendly emoji reaction to salutations and thanks
controller.hears([ 'hello', 'hi', 'hey', 'thanks' ], 'direct_message,direct_mention,mention', function(bot, message) {
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

// shuts down when asked
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

// check if currently available
controller.hears([/are you free\?*$/, /you free\?*$/, /are you available\?*$/], 'direct_message,direct_mention,mention', function(bot, message) {
  isOccupiedNow(bot, message);
});

function isOccupiedNow(bot, message) {
  isOccupied(function(occupied) {
    if (occupied) {
      bot.reply(message, ("Sorry, but I'm currently reserved for " + occupied.summary))
    } else {
      bot.reply(message, "Yes, I'm free.");
    }
  });
}

// check if available at a particular future time
controller.hears([/are you free (.+?)\?*$/, /are you available (.+?)\?*$/], 'direct_message,direct_mention,mention', function(bot, message) {
  console.log(message.match[1]);

  function respondIfAvailableAtTime(occupied) {
    if (occupied) {
      var start = new Date(Date.parse(occupied.start.dateTime));
      var end = new Date(Date.parse(occupied.end.dateTime));
      bot.reply(message, ("Sorry, but I'm reserved from " + start.format('{h}:{mm}') + " until " + end.format('{h}:{mm}') + " for " + occupied.summary));
    } else {
      bot.reply(message, "Yes, I'm free.");
    }
  }

  // if colloquially checking for now, use existing functionality
  if (controller.hears_regexp(['right now', 'now', 'at the moment'], {'text': message.match[1]})) {  
    isOccupiedNow(bot, message);
  } else {
    var singleTime = Date.create(message.match[1]);
    if (singleTime.isValid()) { 
      isOccupied(respondIfAvailableAtTime, singleTime);
    } else {
      var dateRange = Date.range(message.match[1]);

      if (dateRange.start.isValid() && dateRange.end.isValid()) {
        isOccupied(respondIfAvailableAtTime, dateRange.start, dateRange.end);
      } else {
        bot.reply(message, 'Oops, I do not understand that timing: ' + dateRange.start + ' -- ' + dateRange.end);
      }
    }
    //notImplemented(bot, message, "check future availability");
  }
});

function notImplemented(bot, message, feature) {
  bot.reply(message, ("Oops, sorry, I can't " + feature + " yet."));
}

controller.hears(['can we use you (.+)', 'can we reserve you (.+)', 'can I use you (.+)', 'can I reserve you (.+)'], 'direct_message,direct_mention,mention', function(bot, message) {
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
            'summary': response.text + ' - by ' + user_name,
            'description': 'Reserved using the @littleroom Slackbot',
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


controller.hears(['help'], 'direct_mention,mention', function(bot, message) {
    bot.reply(message, ("DM me with the message 'help' for more information"));
});

controller.hears(['help'], 'direct_message', function(bot, message) {
  bot.reply(message, "I'm the littleroom bot - I help schedule room reservations for the PhD little room.");
  bot.reply(message, "*To see if the room is currently in use*, mention me or DM me and ask 'are you free?'");
  bot.reply(message, "*To make a reservation*, mention me or DM me and ask 'can we reserve you [date, or 'today' or 'tomorrow'] from [start time] to [end time]?'");
});

// new feature suggestions
ISSUE_URL = 'https://github.com/npdoty/little-room-bot/issues';
controller.hears([ 'it would be nice if', 'wouldn\'t it be nice if', 'I would love it if', 'how about if you', 'in future, could you' ], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, "Ooh, good idea. Maybe you could open a new issue for me here: " + ISSUE_URL);
});

// if the sentiment is negative, or if it appears to be a complaint
controller.hears([ 'hate it when', 'hate when', 'annoying when', 'frustrating when', 'frustrated when', 'please stop' ], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, "Sorry to hear that. Maybe you could open a new issue for me here: " + ISSUE_URL);
});

function isOccupied(callback, dateTimeToCheck, endTimeToCheck) {
  // is there an ongoing event?
  var day = new Date();
  
  if (dateTimeToCheck !== undefined) {
    day = dateTimeToCheck.clone();

    if (endTimeToCheck === undefined) { // for future times, check a ten minute window
      endTimeToCheck = dateTimeToCheck.clone().addMinutes(10);
    }
  }

  var morning = new Date(day.setHours(0,0));  // that morning at midnight
  var night = new Date(day.setHours(23,59));
  
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
        console.log('Events for the day:');
        for (var i = 0; i < events.length && ongoing == false; i++) {
          var event = events[i];
          var start = event.start.dateTime;
          var end = event.end.dateTime;
          console.log('%s - %s: %s', start, end, event.summary);

          var startTime = new Date(Date.parse(start));
          var endTime = new Date(Date.parse(end));
          
          if (endTimeToCheck !== undefined) {
            // compare overlapping ranges
            if ( (endTime <= dateTimeToCheck) || (startTime >= endTimeToCheck) ) {
              console.log('event does not overlap with check range');
              continue;
            } else {
              ongoing = true;
              ongoingEvent = event;
            }
          } else { // compare to a single point in time
            var now = new Date(); // default to the current moment         

            if ( now > startTime && now < endTime ) {
                ongoing = true;
                ongoingEvent = event;
            }
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
