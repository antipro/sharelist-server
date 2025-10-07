# Sharelist

> server-side program

## Branch
This is a heroku version, use sendgrid as mail sender.

## Requirement
-------------------
* Nodejs 8.x+
* MySQL 5.7
* heroku (optional - can also run in standalone mode)

## Preparation

use ./sharelist.sql to prepare mysql database.

### For Heroku Environment

prepare environment variables:
* SENDGRID_API_KEY
* database
* user
* password
* mailuser
* mailpwd
* smtpserver
* smtpport
* apiKey
* secretKey

### For Non-Heroku/Standalone Environment

1. Copy `components/config.js.example` to `components/config.js`
2. Update the values in `components/config.js` with your actual configuration:
   - Database credentials (host, user, password, database)
   - Email/SMTP settings (mailuser, mailpwd, smtpserver, smtpport)
   - Baidu API credentials (apiKey, secretKey)

## Build Setup

``` bash
# install dependencies
npm install

# start express server
node index.js
```

## Fixed Issues

* Fixed `ReferenceError` in `components/socketio.js` where `socket.emit()` was called in global functions (`scheduleTimers()` and `updateTimers()`) that didn't have access to the `socket` variable. The erroneous calls have been removed as errors are already being logged.