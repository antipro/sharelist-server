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

var app = require('express')()
var http = require('http').Server(app)
var io = require('socket.io')(http, { origins: '*:*' })
const util = require('util')

try {
  var config = require('./config.js').config
} catch (error) {
  console.log('Please create config.js file.')
  console.log('Content like this:')
  console.log(`exports.config = {
    host: 'host',
    user: 'user',
    password: 'password',
    database: 'database',
    mailuser: 'mailuser',
    mailpwd: 'mailpwd',
    smtpserver: 'smtpserver',
    smtpport: smtpport
  }`)
  process.exit(-1)
}

// init connnection pool of database
const pool = require('mysql').createPool({
  host     : config.host,
  user     : config.user,
  password : config.password,
  database : config.database,
  multipleStatements: true
})

// promise
pool.promise = util.promisify(pool.query)

app.all("*", function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header("Access-Control-Allow-Headers", "Content-Type,Content-Length, Authorization, Accept,X-Requested-With, TOKEN");
  res.header("Access-Control-Allow-Methods","PUT,POST,GET,DELETE,OPTIONS");
  let excludeList = ['/api/login', '/api/verifycode', '/api/signup']
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
  pool.promise('SELECT id AS uid, email, token, name AS uname, timezone FROM users WHERE email = ? AND pwd = SHA1(?)', [req.query.email, req.query.pwd]).then((results, fields) => {
    logger.debug(results)
    if (results.length === 0) {
      res.send({
        state: '001',
        msg: 'message.user_not_existed'
      })
      return
    }
    res.send({
      state: '000',
      msg: '',
      data: results[0]
    })
  }).catch((err) => {
    logger.debug(err)
    res.send({
      state: '001',
      msg: 'message.login_error'
    })
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
  pool.promise('SELECT 1 FROM users WHERE email = ? AND token IS NOT NULL', [ req.query.email ]).then((results, fields) => {
    logger.debug(results)
    if (results.length !== 0) {
      res.send({
        state: '001',
        msg: 'message.user_already_existed'
      })
      return Promise.reject()
    }
    return pool.promise('INSERT INTO verifycodes(email, uuid, code, expire) VALUES(?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))', [ req.query.email, uuid, code ])
  }).then(results => {
    var email = require('emailjs');
    var server = email.server.connect({
      user: config.mailuser,
      password: config.mailpwd,
      host: config.smtpserver,
      port: config.smtpport,
      ssl: true
    });
    let mailcontent = req.query.mailcontent
    let mailsender = req.query.mailsender
    let mailsubject = req.query.mailsubject
    server.promise = util.promisify(server.send)
    return server.promise({
      text: mailcontent.replace('{code}', code),
      from: `${mailsender} <${config.mailuser}>`,
      to: req.query.email,
      subject: mailsubject,
      attachment:
      [
        { data: `<html><p>${mailcontent.replace('{code}', '<b>' + code + '</b>')}</p></html>`, alternative: true }
      ]
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
    if (err instanceof Error) {
      logger.debug(err)
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
  pool.promise('SELECT 1 FROM verifycodes WHERE email = ? AND uuid = ? AND code = ?', [ email, uuid, verifycode ]).then(results => {
    if (results.length === 0) {
      res.send({
        state: '001',
        msg: 'message.error_code_or_timeout'
      })
      return
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
        return
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
    console.error(err)
    res.send({
      state: '001',
      msg: 'message.signup_error'
    })
  })
})

/**
 * Shared users of project
 */
app.get('/api/shares/:pid', (req, res) => {
  pool.promise('SELECT b.id AS uid, b.email, name AS uname FROM shares a, users b WHERE a.pid = ? AND a.uid = b.id', [ req.params.pid ]).then((results, fields) => {
    logger.debug(results)
    res.send({
      state: '000',
      msg: '',
      data: results
    })
  }).catch((err) => {
    console.error(err)
    res.send({
      state: '001',
      msg: 'message.query_error'
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

/**
 * Socket object collection
 * user.id:array[socket]
 */
const sockets = new Object()

/**
 * Timer object collection
 * task.id:array[timeout]
 */
let timers = new Object()
/**
 * update all timers of some task
 * @param id task.id
 */
function updateTimers (id) {
  logger.debug('update timer of task #%d', id)
  if (timers[id]) {
    timers[id].forEach(timer => {
      clearTimeout(timer)
    })
  }
  timers[id] = new Array()
  // Query all users related with this task
  let sql = `SELECT a.id, a.content, b.name AS pname, b.uid, DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(IFNULL(a.notify_time, u.notify_time), \'%H:%i\') AS notify_time, u.timezone 
    FROM tasks a, projects b, users u WHERE a.id = ? AND a.pid = b.id AND b.uid = u.id AND a.state = 0 AND a.notify_date IS NOT NULL 
    UNION
    SELECT a.id, a.content, c.name AS pname, b.uid, DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(IFNULL(a.notify_time, u.notify_time), \'%H:%i\') AS notify_time, u.timezone 
    FROM tasks a, shares b, projects c, users u WHERE a.id = ? AND b.uid = u.id AND a.pid = b.pid AND b.pid = c.id AND a.state = 0 AND a.notify_date IS NOT NULL` 
  pool.promise(sql, [ id, id ]).then(results => {
    results.forEach(task => {
      // Server Current Time (UTC+8)
      let current_time = Date.now()
      // Notify Time (with timezone offset)
      let future_time = Date.parse(task.notify_date + ' ' + task.notify_time + ':00') + (-3600 * 1000 * (task.timezone - 8))
      if (future_time < current_time) {
        return
      }
      let timer = setTimeout(() => {
        if (sockets[task.uid]) {
          logger.debug('push task #%d to user #%d', task.id, task.uid)
          sockets[task.uid].forEach(s => {
            s.emit('task notified', task)
          })
        }
      }, future_time - current_time)
      timers[id].push(timer)
    })
    logger.debug(timers)
  }).catch((err) => {
    console.error(err)
    socket.emit('error event', 'message.query_error')
  })
}

// init all timers
let sql = `SELECT id FROM tasks WHERE state = 0 AND notify_date IS NOT NULL`
pool.promise(sql).then(results => {
  results.forEach(task => {
    updateTimers(task.id)
  })
}).catch((err) => {
  console.error(err)
  socket.emit('error event', 'message.query_error')
})

/**
 * socket connection event
 */
io.on('connection', (socket) => {
  if (socket.handshake.query.token === '') {
    logger.debug('invalid user disconnect')
    socket.disconnect()
    return
  }
  let socketUid = socket.handshake.query.uid
  let socketUname = socket.handshake.query.uname
  logger.debug('user %d:%s connected', socketUid, socketUname)
  if (!sockets[socketUid]) {
    sockets[socketUid] = new Array()
  }
  sockets[socketUid].push(socket)
  logger.debug(sockets)

  let sql1 = `SELECT a.id, a.uid, a.content, b.name AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
      DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
      FROM tasks a, projects b WHERE a.pid = b.id AND b.uid = ${socketUid} AND a.state <> 2
      UNION
      SELECT a.id, a.uid, a.content, c.name AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
      DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
      FROM tasks a, shares b, projects c WHERE a.pid = b.pid AND b.pid = c.id AND b.uid = ${socketUid} AND a.state <> 2
      UNION
      SELECT a.id, a.uid, a.content, '' AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
      DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
      FROM tasks a WHERE a.pid = 0 AND a.uid = ${socketUid} AND a.state <> 2`
  let sql2 = `SELECT a.id, a.uid, u.name AS uname, a.name, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, a.editable, \'\' AS control 
      FROM projects a, users u WHERE a.uid = ${socketUid} AND a.state = 0 AND a.uid = u.id
      UNION 
      SELECT a.id, a.uid, u.name AS uname, a.name, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, \'\' AS editable, b.control 
      FROM projects a, shares b, users u WHERE b.uid = ${socketUid} AND a.id = b.pid AND a.state = 0 AND a.uid = u.id`
  let sql3 = `SELECT DATE_FORMAT(notify_time, \'%H:%i\') AS notify_time, locale FROM users WHERE id = ${socketUid}`
  let callback = (results) => {
    let tasks = results[0]
    let projects = results[1]
    let preference = results[2][0]
    projects.forEach(project => {
      socket.join('project ' + project.id)
    })
    socket.emit('init', {
      tasks,
      projects,
      preference
    })
  }
  pool.promise(sql1 + ';' + sql2 + ';' + sql3).then(callback).catch((err) => {
    console.error(err)
    socket.emit('error event', 'message.query_error')
  })

  /**
   * all data event
   */
  socket.on('refresh', (fn) => {
    pool.promise(sql1 + ';' + sql2 + ';' + sql3).then((results) => {
      callback(results)
      fn()
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', 'message.query_error')
    })
  })

  /**
   * add project event
   */
  socket.on('addproject', ({ name }) => {
    (async () => {
      let result = await pool.promise('INSERT INTO projects SET ?', { uid: socketUid, name })
      let pid = result.insertId
      sockets[socketUid].forEach(s => {
        s.join('project ' + pid)
      })
      let results = await pool.promise(`SELECT id AS id, uid, name, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, editable, \'\' AS control 
        FROM projects WHERE id = ?`, pid)
      let project = results[0]
      sockets[socketUid].forEach(s => {
        s.emit('project added', project)
      })
    })().catch((err) => {
      console.error(err)
      socket.emit('error event', 'message.add_error')
    })
  })

  /**
   * add task event
   */
  socket.on('addtask', ({ pid, content, notify_date }) => {
    (async () => {
      let result = await pool.promise('INSERT INTO tasks SET ?', { uid: socketUid, pid, content, notify_date })
      let id = result.insertId
      updateTimers(id)

      let results = await pool.promise(`SELECT a.id, a.uid, a.content, IFNULL(b.name, '') AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
        DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
        FROM tasks a LEFT JOIN projects b ON a.pid = b.id WHERE a.id = ?`, id)
      let task = results[0]
      if (pid === 0) { // task wihtout project is private
        sockets[socketUid].forEach(s => {
          s.emit('task added', task)
        })
      } else {  // task with project shared with other
        socket.emit('task added', task).to('project ' + pid).emit('task added', task, { uid: socketUid, uname: socketUname })
      }
    })().catch((err) => {
      console.error(err)
      socket.emit('error event', 'message.add_error')
    })
  })

  /**
   * remove project event
   */
  socket.on('removeproject', ({ pid, pname }) => {
    (async () => {
      await pool.promise('UPDATE projects SET state = 1 WHERE id = ?', [ pid ])
      await pool.promise('UPDATE tasks SET state = 2 WHERE pid = ?', [ pid ])
      socket.emit('project removed', pid, pname).to('project ' + pid).emit('project removed', pid, pname, { uid: socketUid, uname: socketUname })
      socket.leave('project ' + pid)

      let results = await pool.promise('SELECT uid FROM shares WHERE pid = ?', [ pid ])
      results.forEach(uid => {
        if (sockets[uid]) {
          sockets[uid].forEach(s => {
            s.leave('project ' + pid)
          })
        }
      })
      await pool.promise('DELETE FROM shares WHERE pid = ?', [ pid ])

      results = await pool.promise('SELECT id FROM tasks WHERE pid = ?', [ pid ])
      results.forEach(task => {
        updateTimers(task.id)
      })
    })().catch((err) => {
      console.error(err)
      socket.emit('error event', 'message.remove_error')
    })
  })

  /**
   * remove task event
   */
  socket.on('removetask', ({ id, pid, content }) => {
    (async () => {
      let result = await pool.promise('UPDATE tasks SET state = 2 WHERE ?', { id })
      if (result.affectedRows > 0) {
        if (pid === 0) { // task wihtout project is private
          sockets[socketUid].forEach(s => {
            s.emit('task removed', id)
          })
        } else {  // task with project shared with other
          socket.emit('task removed', id, content).to('project ' + pid).emit('task removed', id, content, { uid: socketUid, uname: socketUname })
        }
        updateTimers(id)
      }
    })().catch((err) => {
      console.error(err)
      socket.emit('error event', 'message.remove_error')
    })
  })

  /**
   * toggle task event
   */
  socket.on('toggletask', ({ id, state, pid }) => {
    (async () => {
      await pool.promise('UPDATE tasks SET state = ? WHERE id = ?', [ state, id ])
      let results = await pool.promise(`SELECT a.id, a.uid, a.content, IFNULL(b.name, '') AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
        DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
        FROM tasks a LEFT JOIN projects b ON a.pid = b.id WHERE a.id = ?`, id)
      let task = results[0]
      if (pid === 0) { // task wihtout project is private
        sockets[socketUid].forEach(s => {
          s.emit('task toggled', task)
        })
      } else {  // task with project shared with other
        socket.emit('task toggled', task).to('project ' + pid).emit('task toggled', task, { uid: socketUid, uname: socketUname })
      }
      updateTimers(id)
    })().catch((err) => {
      console.error(err)
      socket.emit('error event', 'message.update_error')
    })
  })

  /**
   * update project event
   */
  socket.on('updateproject', ({ pid, pname, shares }) => {
    (async () => {
      let result = await pool.promise('UPDATE projects SET name = ? WHERE id = ?', [ pname, pid ])
      if (result.affectedRows > 0) {
        socket.emit('project updated', {
          id: pid,
          name: pname
        }).to('project ' + pid).emit('project updated', {
          id: pid,
          name: pname
        }, {
          uid: socketUid,
          uname: socketUname
        })
      }
      
      console.debug('unshared project event')
      let results = await pool.promise('SELECT uid FROM shares WHERE pid = ?', [ pid ])
      const old_uids = results.map(row => row.uid)
      const new_uids = shares.map(share => share.uid)
      old_uids.map(uid => {
        // withdraw sharing
        if (new_uids.indexOf(uid) === -1) {
          logger.debug('unshared with %d', uid)
          pool.promise('DELETE FROM shares WHERE pid = ? AND uid = ?', [ pid, uid ])
          if (sockets[uid]) {
            sockets[uid].forEach(s => {
              s.emit('project unshared', pid, { uname: socketUname }).leave('project ' + pid)
            })
          }
        }
      })

      console.debug('add new user if not existed')
      for (let idx = 0; idx < shares.length; idx++) {
        const share = shares[idx];
        if (share.uid === 0) {
          results = await pool.promise('SELECT id FROM users WHERE email = ?', [ share.email ])
          if (results.length === 0) {
            result = await pool.promise('INSERT INTO users SET ?', { email: share.email })
            share.uid = result.insertId
          } else {
            share.uid = results[0].id
          }
        }
      }

      console.debug('add new share relationship %s and share project event', shares)
      for (let share of shares) {
        results = await pool.promise('SELECT 1 FROM shares WHERE pid = ? AND uid = ?', [pid, share.uid])
        if (results.length === 0) {
          await pool.promise('INSERT INTO shares SET ?', { pid, uid: share.uid })
        }
        if (sockets[share.uid]) {
          sockets[share.uid].forEach(s => {
            s.emit('project shared', pid, { uname: socketUname }).join('project ' + pid)
          })
        }
      }

      console.debug('update timer')
      results = await pool.promise('SELECT id FROM tasks WHERE pid = ?', [ pid ])
      results.forEach(task => {
        updateTimers(task.id)
      })
    })().catch(err => {
      console.error(err)
      socket.emit('error event', 'message.update_error')
    })
  })

  /**
   * update task event
   */
  socket.on('updatetask', ({ id, pid, content, notify_date, notify_time }) => {
    (async () => {
      if (notify_date === '') {
        notify_date = null
      }
      if (notify_time === '') {
        notify_time = null
      }
      let result = await pool.promise('UPDATE tasks SET content = ?, notify_date = ?, notify_time = ? WHERE id = ?', [content, notify_date, notify_time, id])
      if (result.affectedRows > 0) {
        let results = await pool.promise(`SELECT a.id, a.uid, a.content, IFNULL(b.name, '') AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
          DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
          FROM tasks a LEFT JOIN projects b ON a.pid = b.id WHERE a.id = ?`, id)
  
        let task = results[0]
        if (pid === 0) { // task wihtout project is private
          sockets[socketUid].forEach(s => {
            s.emit('task updated', task)
          })
        } else {  // task with project shared with other
          socket.emit('task updated', task).to('project ' + pid).emit('task updated', task, { uid: socketUid, uname: socketUname })
        }
        updateTimers(id)
      }
    })().catch(err => {
      console.error(err)
      socket.emit('error event', 'message.update_error')
    })
  })

  /**
   * update preference event
   */
  socket.on('updatepreference', preference => {
    (async () => {
      await pool.promise('UPDATE users SET ? WHERE id = ' + socketUid, preference)
      if (sockets[socketUid]) {
        sockets[socketUid].forEach(s => {
          s.emit('preference updated', preference)
        })
      }
      let sql = `SELECT a.id 
          FROM tasks a, projects b WHERE b.uid = ? AND a.pid = b.id AND a.state = 0 AND a.notify_date >= CURRENT_DATE AND a.notify_time IS NULL
          UNION
          SELECT a.id
          FROM tasks a, shares b WHERE b.uid = ? AND a.pid = b.pid AND a.state = 0 AND a.notify_date >= CURRENT_DATE AND a.notify_time IS NULL
          UNION
          SELECT a.id
          FROM tasks a WHERE a.uid = ? AND a.pid = 0 AND a.state = 0 AND a.notify_date >= CURRENT_DATE AND a.notify_time IS NULL`
      let results = await pool.promise(sql, [ socketUid, socketUid, socketUid ])
      results.forEach(task => {
        updateTimers(task.id)
      })
    })().catch(err => {
      console.error(err)
      socket.emit('error event', 'message.update_error')
    })
  })

  /**
   * reset password event
   */
  socket.on('resetpwd', (oldpwd, pwd) => {
    (async () => {
      let results = await pool.promise('SELECT 1 FROM users WHERE id = ? AND pwd = SHA1(?)', [ socketUid, oldpwd ])
      if (results.length === 0) {
        socket.emit('error event', 'message.pwd_error')
        return
      }
      const uuidv1 = require('uuid/v1');
      const uuid = uuidv1();
      await pool.promise('UPDATE users SET pwd = SHA1(?), token = ? WHERE id = ?', [ pwd, uuid, socketUid ])
      if (sockets[socketUid]) {
        sockets[socketUid].forEach(s => {
          s.emit('pwd reseted')
        })
      }
    })().catch(err => {
      console.error(err)
      socket.emit('error event', 'message.update_error')
    })
  })

  /**
   * disconnection event
   */
  socket.on('disconnect', () => {
    logger.debug('user %d disconnected', socketUid)
    sockets[socketUid] = sockets[socketUid].filter(s => s.id !== socket.id)
    for(let id in timers) {
      clearTimeout(timers[id])
      delete timers[id]
    }

    if (sockets[socketUid].length === 0)
      delete sockets[socketUid]
    logger.debug(sockets)
  })
})

http.listen(process.env.PORT || 5000, () => {
  logger.debug('listening on *:%d', process.env.PORT || 5000)
})