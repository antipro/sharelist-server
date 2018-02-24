/**
 * 
 * @param {Pool} pool 
 * @param {Function} sendmail 
 * @param {Logger} logger 
 */
module.exports = function (pool, sendmail, logger) {
  var app = require('express')()

  app.all("*", function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header("Access-Control-Allow-Headers", "Content-Type,Content-Length, Authorization, Accept,X-Requested-With, TOKEN");
    res.header("Access-Control-Allow-Methods","PUT,POST,GET,DELETE,OPTIONS");
    if (req.method === 'OPTIONS') {
      next()
      return
    }
    let excludeList = ['/api/login', '/api/verifycode', '/api/signup', '/api/findpwd', '/api/checkuser']
    if (excludeList.indexOf(req.path) === -1) {
      let token = req.get('TOKEN')
      if (!token) {
        res.send({
          state: '001',
          msg: 'message.not_logged_in'
        })
        return
      }
    }
    next();
  });
  
  /**
   * Login
   */
  app.get('/api/login', (req, res) => {
    (async () => {
      let results = await pool.promise('SELECT 1 FROM users WHERE email = ?', [ req.query.email ])
      if (results.length === 0) {
        res.send({
          state: '001',
          msg: 'message.user_not_existed'
        })
        return
      }
      results = await pool.promise('SELECT id AS uid, email, token, name AS uname, timezone FROM users WHERE email = ? AND pwd = SHA1(?)', [ req.query.email, req.query.pwd ])
      if (results.length === 0) {
        res.send({
          state: '001',
          msg: 'message.password_is_not_right'
        })
        return
      }
      logger.debug('login: ', results[0])
      res.send({
        state: '000',
        msg: '',
        data: results[0]
      })
    })().catch(err => {
      logger.error(err)
      res.send({
        state: '001',
        msg: 'message.login_error'
      })
    })
  })
  
  /**
   * Check User Exist Status
   */
  app.get('/api/checkuser', (req, res) => {
    pool.promise('SELECT 1 FROM users WHERE email = ? AND token IS NOT NULL', [ req.query.email ]).then((results, fields) => {
      if (results.length !== 0) {
        res.send({
          state: '000',
          msg: 'message.user_already_existed',
          data: true
        })
      } else {
        res.send({
          state: '000',
          msg: 'message.user_not_existed',
          data: false
        })
      }
    }).catch((err) => {
      if (err instanceof Error) {
        logger.debug(err)
        res.send({
          state: '001',
          msg: 'message.query_error'
        })
      }
    })
  })
  
  /**
   * Verify Code
   */
  app.get('/api/verifycode', (req, res) => {
    const uuidv1 = require('uuid/v1');
    const uuid = uuidv1();
    const stringRandomJs = require("string_random.js").String_random
    const code = stringRandomJs(/\w\d\w\d/);
    pool.promise('INSERT INTO verifycodes(email, uuid, code, expire) VALUES(?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))', [ req.query.email, uuid, code ]).then(results => {
      let mailcontent = req.query.mailcontent
      let mailsender = req.query.mailsender
      let mailsubject = req.query.mailsubject
      return sendmail({
        mailsender,
        to: req.query.email,
        subject: mailsubject,
        text: mailcontent.replace('{code}', code),
        html: `<html><p>${mailcontent.replace('{code}', '<b>' + code + '</b>')}</p></html>`
      })
    }).then(message => {
      res.send({
        state: '000',
        msg: '',
        data: {
          uuid
        }
      })
    }).catch((err) => {
      logger.error(err)
      if (err instanceof Error) {
        res.send({
          state: '001',
          msg: 'message.signup_error'
        })
      }
    })
  })
  
  /**
   * Sign Up
   */
  app.get('/api/signup', (req, res) => {
    let email = req.query.email;
    let username = req.query.username;
    let pwd = req.query.pwd;
    let uuid = req.query.uuid;
    let verifycode = req.query.verifycode;
    let timezone = req.query.timezone;
    pool.promise('SELECT 1 FROM verifycodes WHERE email = ? AND uuid = ? AND code = ? AND expire > NOW()', [ email, uuid, verifycode ]).then(results => {
      if (results.length === 0) {
        res.send({
          state: '001',
          msg: 'message.error_code_or_timeout'
        })
        return Promise.reject('error_code_or_timeout')
      }
      return pool.promise('SELECT id, token FROM users WHERE email = ?', [ email ])
    }).then(results => {
      if (results.length === 0) {
        return pool.promise('INSERT INTO users(email, name, pwd, token, timezone, ctime) VALUES(?, ?, SHA1(?), ?, ?, NOW())', [email, username, pwd, uuid, timezone ]).then(results => {
          return Promise.resolve(results.insertId)
        })
      } else {
        if (results[0].token !== null) {
          res.send({
            state: '001',
            msg: 'message.user_already_existed'
          })
          return Promise.reject('user_already_existed')
        } else {
          let id = results[0].id
          return pool.promise('UPDATE users SET name = ?, pwd = SHA1(?), token = ?, timezone = ?, ctime = NOW() WHERE id = ?', [ username, pwd, uuid, timezone, id ]).then(results => {
            return Promise.resolve(id)
          })
        }
      }
    }).then(id => {
      return pool.promise('SELECT id AS uid, email, token, name AS uname, timezone FROM users WHERE id = ?', [ id ])
    }).then(results => {
      res.send({
        state: '000',
        msg: '',
        data: results[0]
      })
    }).catch((err) => {
      logger.error(err)
      if (err instanceof Error) {
        res.send({
          state: '001',
          msg: 'message.signup_error'
        })
      }
    })
  })
  
  /**
   * Find Pwd
   */
  app.get('/api/findpwd', (req, res) => {
    let email = req.query.email
    let pwd = req.query.pwd
    let uuid = req.query.uuid
    let verifycode = req.query.verifycode
    let uid = 0
    pool.promise('SELECT 1 FROM verifycodes WHERE email = ? AND uuid = ? AND code = ? AND expire > NOW()', [ email, uuid, verifycode ]).then(results => {
      if (results.length === 0) {
        res.send({
          state: '001',
          msg: 'message.error_code_or_timeout'
        })
        return
      }
      return pool.promise('SELECT id FROM users WHERE email = ?', [ email ])
    }).then(results => {
      if (results.length ===0) {
        res.send({
          state: '001',
          msg: 'message.user_not_existed'
        })
        return
      }
      uid = results[0].id
      return pool.promise('UPDATE users SET pwd = SHA1(?), token = ? WHERE id = ?', [ pwd, uuid, uid ])
    }).then(results => {
      if (sockets[uid]) {
        sockets[uid].forEach(s => {
          s.emit('pwd reseted')
        })
      }
      res.send({
        state: '000',
        msg: ''
      })
    }).catch((err) => {
      console.error(err)
      res.send({
        state: '001',
        msg: 'message.update_error'
      })
    })
  })
  
  /**
   * Project info and tasks
   */
  app.get('/api/projects/:pid', (req, res) => {
    let sql1 = `SELECT a.id, a.uid, a.content, b.name AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
      DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
      FROM tasks a, projects b WHERE a.pid = ${req.params.pid} AND a.state <> 2 AND a.pid = b.id`
    let sql2 = `SELECT a.id, a.uid, u.name AS uname, a.name, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, a.editable, \'\' AS control 
      FROM projects a, users u WHERE a.id = ${req.params.pid} AND a.uid = u.id`
    pool.promise(sql1 + ';' + sql2).then(results => {
      let tasks = results[0]
      let project = results[1][0]
      res.send({
        state: '000',
        msg: '',
        data: {
          tasks,
          project
        }
      })
    }).catch(err => {
      console.error(err)
      res.send({
        state: '001',
        msg: 'message.query_error'
      })
    })
  })

  return app
}