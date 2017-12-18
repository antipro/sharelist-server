# Sharelist

> server-side program

## Requirement
-------------------
* Nodejs 8.x+
* MySQL 5.7

## Preparation

use ./sharelist.sql to prepare mysql database.

create ./config.js, like below:
```
exports.config = {
  host: 'IP',
  user: 'username',
  password: 'password',
  database: 'databasename',
  mailuser: 'mailaddress',
  mailpwd: 'mailpassword',
  smtpserver: 'smtpserver',
  smtpport: smtpport
}
```

## Build Setup

``` bash
# install dependencies
npm install

# start express server
node index.js
```