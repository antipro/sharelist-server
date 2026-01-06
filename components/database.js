/**
 * database pool function
 */
var config = {
  host: process.env.host,
  user: process.env.user,
  password: process.env.password,
  database: process.env.database
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