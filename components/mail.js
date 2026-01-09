/**
 * sendmail function
 */
var config = {
  mailuser: process.env.mailuser || '',
  mailpwd: process.env.mailpwd || '',
  smtpserver: process.env.smtpserver || '',
  smtpport: parseInt(process.env.smtpport) || 0
}
const email = require('emailjs')
const util = require('util')
exports.sendmail = function (mail) {
  var server = email.server.connect({
    user: config.mailuser,
    password: config.mailpwd,
    host: config.smtpserver,
    port: config.smtpport,
    ssl: true
  });
  server.promise = util.promisify(server.send)
  return server.promise({
    text: mail.text,
    from: `${mail.mailsender} <${config.mailuser}>`,
    to: mail.to,
    subject: mail.subject,
    attachment:
    [
      { data: mail.html, alternative: true }
    ]
  })
}
