const Expo = require('expo-server-sdk');
const Airtable = require('airtable');
const express = require('express')
const wakeDyno = require("woke-dyno");

const DYNO_URL = 'https://trainee-1951coffee.herokuapp.com/';

const app = express()
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
  wakeDyno(DYNO_URL).start(); // DYNO_URL should be the url of your Heroku app
})

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const AirtableColumnEnum = Object.freeze({
  timePosted: 'timePosted'
});

const expo = new Expo.Expo();
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID,
);

class NotificationsManager {
  constructor() {
    this.pushSettings = {};
    this.sent = [];
  }

  addNotification(settings) {
    this.pushSettings[settings.table] =  settings;
  }

  createPushMessages(records, settings) {
    records = records.filter((record) => {
      const isNewRecord = !this.sent.includes(record.getId());
      isNewRecord ? this.sent.push(record.getId()) : null;
      this.sent.length >= 100 ? this.sent.slice(50) : null;
      return isNewRecord ? record.get(settings.tokenColumnName) : null;
    });

    return records.map((record) => {
      console.log("\nCreating push message: ", record.get(settings.tokenColumnName).split());
      return {
        to: record.get(settings.tokenColumnName).split(','),
        body: settings.recordTemplate(record),
        sound: 'default',
      };
    });
  }

  async sendNotifications() {
    let messages = [];
    for (const table in this.pushSettings) {
      const settings = this.pushSettings[table];

      await base(settings.table).select(settings.queryParams).eachPage(
        async (records, fetchNextPage) => {
          const newMessages = this.createPushMessages(records, settings);
          messages = messages.concat(newMessages);
          fetchNextPage();
        }
      );
    }

    let chunks = expo.chunkPushNotifications(messages);
    let tickets = [];
    (async () => {
      // Send the chunks to the Expo push notification service. There are
      // different strategies you could use. A simple one is to send one chunk at a
      // time, which nicely spreads the load out over time:
      for (let chunk of chunks) {
        try {
          let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
          console.log("\nNotification chunk sent");
          console.log(tickets)
          // NOTE: If a ticket contains an error code in ticket.details.error, you
          // must handle it appropriately. The error codes are listed in the Expo
          // documentation:
          // https://docs.expo.io/versions/latest/guides/push-notifications#response-format
        } catch (error) {
          console.log(error);
        }
      }
    })();
  }

  async start() {
    while (true) {
      this.sendNotifications();
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

function messagesTemplate(record) {
  return record.get('body');
}

const manager = new NotificationsManager();
manager.addNotification({
  table: "Messages", 
  queryParams: {
    view: "main",
    filterByFormula: 'DATETIME_DIFF(CREATED_TIME(), TODAY(), "days") = 0',
  },
  recordTemplate: messagesTemplate,
  tokenColumnName: 'recipientTokens',
});
manager.start();