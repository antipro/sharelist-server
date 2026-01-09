/**
 * database pool function
 */
var config = {
  host: process.env.host || 'localhost',
  user: process.env.user || 'support',
  password: process.env.password || 'support',
  database: process.env.database || 'sharelist'
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