/**
 * Socket object collection
 * user.id:array[socket]
 */
const sockets = new Object()

/**
 * Timer object collection
 * task.id:array[timeout]
 */
const timers = new Object()

/**
 * 
 * @param {Server} http 
 * @param {Pool} pool 
 * @param {Function} sendmail 
 * @param {Logger} logger 
 * @param {Function} fetchToken 
 */
module.exports = function (http, pool, sendmail, logger, fetchToken) {

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
        if (future_time - current_time > 2147483647) {
          logger.debug(task.notify_date + ' ' + task.notify_time + ':00 too long for notification')
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
      logger.error(err)
    })
  }

  // init all timers
  function scheduleTimers () {
    let sql = `SELECT id FROM tasks WHERE state = 0 AND notify_date IS NOT NULL`
    pool.promise(sql).then(results => {
      results.forEach(task => {
        updateTimers(task.id)
      })
    }).catch((err) => {
      logger.error(err)
    })
  }
  scheduleTimers()
  setInterval(scheduleTimers, 24 * 3600 * 1000)

  var io = require('socket.io')(http, { origins: '*:*' })
  
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
    pool.promise('SELECT 1 FROM users WHERE id = ? AND token = ?', [ socketUid, socket.handshake.query.token ]).then(results => {
      if (results.length === 0) {
        logger.debug('token and id is not in pair')
        socket.emit('relogin')
      }
    }).catch((err) => {
      logger.error(err)
      socket.emit('relogin')
    })
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
    let postProcess = (results) => {
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
    pool.promise(sql1 + ';' + sql2 + ';' + sql3).then(postProcess).catch((err) => {
      logger.error(err)
      socket.emit('error event', 'message.query_error')
    })
  
    /**
     * all data event
     */
    socket.on('refresh', (callback) => {
      pool.promise(sql1 + ';' + sql2 + ';' + sql3).then((results) => {
        postProcess(results)
        callback()
      }).catch((err) => {
        logger.error(err)
        socket.emit('error event', 'message.query_error')
      })
    })
  
    /**
     * add project event
     */
    socket.on('addproject', ({ name }, callback) => {
      (async () => {
        let result = await pool.promise('INSERT INTO projects SET ?', { uid: socketUid, name })
        let pid = result.insertId
        sockets[socketUid].forEach(s => {
          s.join('project ' + pid)
        })
        let results = await pool.promise(`SELECT id AS id, uid, name, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, editable, \'\' AS control 
          FROM projects WHERE id = ?`, pid)
        let project = results[0]
        if (callback) {
          callback(project)
        }
        sockets[socketUid].forEach(s => {
          s.emit('project added', project)
        })
      })().catch((err) => {
        logger.error(err)
        socket.emit('error event', 'message.add_error')
      })
    })
  
    /**
     * add task event
     */
    socket.on('addtask', ({ pid, content, notify_date }, callback) => {
      (async () => {
        let result = await pool.promise('INSERT INTO tasks SET ?', { uid: socketUid, pid, content, notify_date })
        let id = result.insertId
        updateTimers(id)
  
        let results = await pool.promise(`SELECT a.id, a.uid, a.content, IFNULL(b.name, '') AS pname, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
          DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time 
          FROM tasks a LEFT JOIN projects b ON a.pid = b.id WHERE a.id = ?`, id)
        let task = results[0]
        if (callback) {
          callback(task)
        }
        if (pid === 0) { // task wihtout project is private
          sockets[socketUid].forEach(s => {
            s.emit('task added', task)
          })
        } else {  // task with project shared with other
          socket.emit('task added', task).to('project ' + pid).emit('task added', task, { uid: socketUid, uname: socketUname })
        }
      })().catch((err) => {
        logger.error(err)
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
        logger.error(err)
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
        logger.error(err)
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
        logger.error(err)
        socket.emit('error event', 'message.update_error')
      })
    })
  
    /**
     * update project event
     */
    socket.on('updateproject', ({ pid, pname, shares, mailsender, share_subject, share_description }) => {
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
        
        logger.log('unshared project event')
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
  
        logger.log('add new user if not existed')
        for (let share of shares) {
          if (share.uid === 0) {
            results = await pool.promise('SELECT id, ctime FROM users WHERE email = ?', [ share.email ])
            if (results.length === 0) {
              result = await pool.promise('INSERT INTO users SET ?', { email: share.email })
              share.uid = result.insertId
              share.registed = false
            } else {
              share.uid = results[0].id
              if (results[0].ctime === null) {
                share.registed = false
              } else {
                share.registed = true
              }
            }
          }
        }
  
        logger.log('add new share relationship %s and share project event', shares)
        for (let share of shares) {
          results = await pool.promise('SELECT 1 FROM shares WHERE pid = ? AND uid = ?', [pid, share.uid])
          if (results.length === 0) {
            await pool.promise('INSERT INTO shares SET ?', { pid, uid: share.uid })
            if (share.registed === false) { // user not registed
              const pug = require('pug')
              let html = pug.renderFile('tpl/projectshared.pug', {
                mailsender,
                description: share_description
              })
              sendmail({
                mailsender,
                to: share.email,
                subject: share_subject,
                text: ' ',
                html: html
              }).catch(err => {
                logger.error('sharing email failed', err)
              })
            }
          }
          if (sockets[share.uid]) {
            sockets[share.uid].forEach(s => {
              s.emit('project shared', pid, { uname: socketUname }).join('project ' + pid)
            })
          }
        }
  
        logger.log('update timer')
        results = await pool.promise('SELECT id FROM tasks WHERE pid = ?', [ pid ])
        results.forEach(task => {
          updateTimers(task.id)
        })
      })().catch(err => {
        logger.error(err)
        socket.emit('error event', 'message.update_error')
      })
    })
  
    /**
     * update task event
     */
    socket.on('updatetask', ({ id, pid, content, notify_date, notify_time }, callback) => {
      (async () => {
        if (notify_date === '') {
          notify_date = null
        }
        if (notify_time === '') {
          notify_time = null
        }
        let result = await pool.promise('UPDATE tasks SET content = ?, notify_date = ?, notify_time = ? WHERE id = ?', [content, notify_date, notify_time, id])
        if (result.affectedRows > 0) {
          if (callback) {
            callback()
          }
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
        logger.error(err)
        socket.emit('error event', 'message.update_error')
      })
    })
  
    /**
     * Shared users of project
     */
    socket.on('querysharedusers', (pid, callback) => {
      (async () => {
        let results = await pool.promise('SELECT b.id AS uid, b.email, name AS uname FROM shares a, users b WHERE a.pid = ? AND a.uid = b.id', [ pid ])
        callback(results)
      })().catch(err => {
        logger.error(err)
        socket.emit('error event', 'message.query_error')
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
        logger.error(err)
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
        logger.error(err)
        socket.emit('error event', 'message.update_error')
      })
    })
  
    /**
     * send data to email, then delete account and data
     * @event deleteaccount
     */
    socket.on('deleteaccount', ({ mailsender, ungrouped, subject }) => {
      (async () => {
        let results = await pool.promise('SELECT email, locale FROM users WHERE id = ?', [ socketUid ])
        let { email, locale } = results[0]
        // get projects
        let tasks = await pool.promise(`SELECT a.id, a.state, a.content, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
            DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time, 
            b.name AS pname FROM tasks a 
            LEFT JOIN projects b ON a.pid = b.id 
            WHERE b.uid = ? OR (a.pid = 0 AND a.uid = ?) ORDER BY a.pid, a.state, a.id`, [ socketUid, socketUid ])
        const pug = require('pug')
        const i18n = require('./locale')
        let html = pug.renderFile('tpl/accountdeleted.pug', {
          subject,
          tasks,
          locale,
          i18n
        })
        return sendmail({
          mailsender,
          to: email,
          subject,
          text: ' ',
          html: html
        })
      })().then(async () => {
        await pool.promise('DELETE FROM users WHERE id = ?', [ socketUid ])
        await pool.promise('DELETE FROM shares WHERE uid = ?', [ socketUid ])
        await pool.promise('DELETE a.* FROM tasks a, projects b WHERE b.uid = ? AND a.pid = b.id', [ socketUid ])
        await pool.promise('DELETE FROM tasks WHERE uid = ? AND pid = 0', [ socketUid ])
        await pool.promise('DELETE FROM projects WHERE uid = ?', [ socketUid ])
        if (sockets[socketUid]) {
          sockets[socketUid].forEach(s => {
            s.emit('account deleted')
          })
        }
      }).catch(err => {
        logger.error(err)
        socket.emit('error event', 'message.remove_error')
      })
    })
  
    socket.on('fetchtoken', (callback) => {
      callback(fetchToken())
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

}