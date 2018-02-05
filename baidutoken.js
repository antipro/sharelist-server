import { setInterval } from 'timers';

/**
 * baidu speech recognition token
 */
if (process.env['DYNO'] !== undefined) { // heroku environment
  var config = {
    apiKey: process.env.apiKey,
    secretKey: process.env.secretKey
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

var access_token = ''
var expiredDate = Date.now()

const https = require('https')
function refrashToken () {
  https.get(`https://openapi.baidu.com/oauth/2.0/token?grant_type=client_credentials&client_id=${config.apiKey}&client_secret=${config.secretKey}`, (resp) => {
    let data = ''
    resp.on('data', (chunk) => {
      data += chunk
    })
    resp.on('end', () => {
      console.log('baidu token:',  data)
      let res = JSON.parse(data)
      access_token = res.access_token
      expiredDate = Date.now() + res.expires_in * 1000
    })
  }).on('error', (err) => {
    console.log('Error: ' + err.message)
  })
}

refrashToken()
setInterval(() => {
  let currentMill = Date.now()
  // refrash token two days early
  if (currentMill + 48 * 3600 * 1000 > expiredDate) {
    refrashToken()
  }
}, 24 * 3600)

module.exports = function () {
  return access_token
}