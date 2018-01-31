# Sharelist

> server-side program

## Branch
This is a heroku version, use sendgrid as mail sender.

## Requirement
-------------------
* Nodejs 8.x+
* MySQL 5.7
* heroku

## Preparation

use ./sharelist.sql to prepare mysql database.

prepre environment variables:
* SENDGRID_API_KEY
* database
* user
* password

## Build Setup

``` bash
# install dependencies
npm install

# start express server
node index.js
```