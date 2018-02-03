/**
 * sendmail function
 */
if (process.env['DYNO'] !== undefined) { // heroku environment
  var config = {
    mailuser: process.env.mailuser,
    mailpwd: process.env.mailpwd,
    smtpserver: process.env.smtpserver,
    smtpport: parseInt(process.env.smtpport)
  }
  const sgMail = require('@sendgrid/mail')
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
  exports.sendmail = function (mail) {
    return sgMail.send({
      to: mail.to,
      from: `${mail.mailsender} <${config.mailuser}>`,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
  }
} else { // indepency environment
  try {
    var config = require('./config.js').config
  } catch (error) {
    console.log('Please create config.js file.')
    console.log('Content like this:')
    console.log(`exports.config = {
      mailuser: 'mailuser',
      mailpwd: 'mailpwd',
      smtpserver: 'smtpserver',
      smtpport: smtpport
    }`)
    process.exit(-1)
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
}
