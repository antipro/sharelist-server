// Set TimeZone
process.env.TZ = 'Asia/Shanghai'
console.log('server startup at %s', new Date())
var setInterval = require('timers').setInterval
var setTimeout = require('timers').setTimeout

// init log4js
const log4js = require('log4js');
log4js.configure({
  appenders: {
    out: { type: 'stdout' },
    app: { type: 'file', filename: 'logs/application.log', maxLogSize: 10485760 }
  },
  categories: {
    default: { appenders: [ 'out', 'app' ], level: 'debug' }
  }
})
const logger = log4js.getLogger()

// init connnection pool of database
var pool = require('./components/database')
// get mail
var sendmail = require('./components/mail').sendmail
// get express
var app = require('./components/express')(pool, sendmail, logger)
// init http server
var http = require('http').Server(app)
// prepare socket.io
require('./components/socketio')(http, pool, sendmail, logger)
// start listening
http.listen(process.env.PORT || 5000, () => {
  logger.debug('listening on *:%d', process.env.PORT || 5000)
})