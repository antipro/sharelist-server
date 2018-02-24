/**
 * database pool function
 */
if (process.env['DYNO'] !== undefined) { // heroku environment
  var config = {
    host: process.env.host,
    user: process.env.user,
    password: process.env.password,
    database: process.env.database
  }
} else { // indepency environment
  try {
    var config = require('./config.js').config
  } catch (error) {
    console.log('Please create config.js file.')
    console.log('Content like this:')
    console.log(`exports.config = {
      host: 'host',
      user: 'user',
      password: 'password',
      database: 'database'
    }`)
    process.exit(-1)
  }
}
// init connnection pool of database
const pool = require('mysql').createPool({
  host     : config.host,
  user     : config.user,
  password : config.password,
  database : config.database,
  multipleStatements: true
})
const util = require('util')
pool.promise = util.promisify(pool.query)
module.exports = pool