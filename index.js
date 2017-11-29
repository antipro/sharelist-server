var app = require('express')()
var http = require('http').Server(app)
var io = require('socket.io')(http, { origins: '*:*' })
const util = require('util')

const pool = require('mysql').createPool({
  host     : 'localhost',
  user     : 'antipro',
  password : '385471c54e',
  database : 'sharelist',
  multipleStatements: true
})

pool.promise = util.promisify(pool.query)

app.all("*", function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header("Access-Control-Allow-Headers", "Content-Type,Content-Length, Authorization, Accept,X-Requested-With, TOKEN");
  res.header("Access-Control-Allow-Methods","PUT,POST,GET,DELETE,OPTIONS");
  if (req.path !== '/api/login') {
    let token = req.get('TOKEN')
    if (!token) {
      res.send({
        state: '001',
        msg: '未登录'
      })
      return
    }
  }
  next();
});
app.get('/api/login', (req, res) => {
  pool.promise('SELECT id AS uid, tel, token, name AS uname FROM users WHERE tel = ? AND pwd = SHA1(?)', [req.query.tel, req.query.pwd]).then((results, fields) => {
    console.log(results)
    if (results.length === 0) {
      res.send({
        state: '001',
        msg: '用户不存在'
      })
      return
    }
    res.send({
      state: '000',
      msg: '',
      data: results[0]
    })
  }).catch((err) => {
    console.log(err)
    res.send({
      state: '001',
      msg: `登录出错：${err}`
    })
  })
})

app.get('/api/shares/:pid', (req, res) => {
  pool.promise('SELECT b.id AS uid, b.tel, name AS uname FROM shares a, users b WHERE a.pid = ? AND a.uid = b.id', [ req.params.pid ]).then((results, fields) => {
    console.log(results)
    res.send({
      state: '000',
      msg: '',
      data: results
    })
  }).catch((err) => {
    console.error(err)
    res.send({
      state: '001',
      msg: `查询分享人员出错：${err}`
    })
  })
})

app.get('/api/projects/:pid', (req, res) => {
  let sql1 = `SELECT id, uid, content, pid, state, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(notify_date, \'%Y-%m-%d\') AS notify_date 
    FROM tasks WHERE pid = ${req.params.pid} AND state <> 2`
  let sql2 = `SELECT id AS id, uid, name, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, editable, \'\' AS control 
    FROM projects WHERE id = ${req.params.pid}`
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
      msg: `查询项目信息出错：${err}`
    })
  })
})

const sockets = new Object()

/**
 * 成功链接
 */
io.on('connection', (socket) => {
  if (socket.handshake.query.token === '') {
    console.log('invalid user disconnect')
    socket.disconnect()
    return
  }
  let uid = socket.handshake.query.uid
  console.log('user %d connected', uid)
  if (!sockets[uid]) {
    sockets[uid] = new Array()
  }
  sockets[uid].push(socket)
  console.log(sockets)

  let sql1 = `SELECT a.id, a.uid, a.content, a.pid, a.state, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date 
      FROM tasks a, projects b WHERE a.pid = b.id AND b.uid = ${uid} AND a.state <> 2
      UNION
      SELECT b.id, b.uid, b.content, b.pid, b.state, DATE_FORMAT(b.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(b.notify_date, \'%Y-%m-%d\') AS notify_date 
      FROM shares a, tasks b WHERE a.uid = ${uid} AND a.pid = b.pid AND b.state <> 2`
  let sql2 = `SELECT id AS id, uid, name, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, editable, \'\' AS control 
      FROM projects WHERE uid = ${uid} AND state = 0
      UNION 
      SELECT b.id, b.uid, b.name, DATE_FORMAT(b.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, \'\' AS editable, a.control 
      FROM shares a, projects b WHERE a.uid = ${uid} AND a.pid = b.id AND b.state = 0`
  pool.promise(sql1 + ';' + sql2).then((results, fields) => {
    let tasks = results[0]
    let projects = results[1]
    projects.forEach(project => {
      socket.join('project ' + project.id)
    });
    socket.emit('init', {
      tasks,
      projects
    })
  }).catch((err) => {
    console.error(err)
    socket.emit('error event', '查询项目出错')
  })

  socket.on('refresh', (fn) => {
    pool.promise(sql1 + ';' + sql2).then((results, fields) => {
      let tasks = results[0]
      let projects = results[1]
      socket.emit('init', {
        tasks,
        projects
      })
      fn()
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '查询项目出错')
    })
  })

  /**
   * 新增任务
   */
  socket.on('addtask', ({ pid, uid, content }) => {
    pool.promise('INSERT INTO tasks SET ?', { uid, pid, content }).then((results, fields) => {
      let id = results.insertId
      return pool.promise(`SELECT id, uid, content, pid, state, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
                            DATE_FORMAT(notify_date, \'%Y-%m-%d\') AS notify_date 
                            FROM tasks WHERE id = ?`, id)
    }).then((results, fields) => {
      socket.emit('task added', results[0]).to('project ' + pid).emit('task added', results[0])
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '新增任务出错')
    })
  })

  /**
   * 删除任务
   */
  socket.on('removeproject', ({ pid }) => {
    pool.promise('UPDATE projects SET state = 1 WHERE id = ?', [ pid ]).then(() => {
      return pool.promise('UPDATE tasks SET state = 2 WHERE pid = ?', [ pid ])
    }).then(() => {
      socket.emit('project removed', pid).to('project ' + pid).emit('project removed', pid)
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '移除任务出错')
    })
  })

  /**
   * 删除任务
   */
  socket.on('removetask', ({ id, pid }) => {
    pool.promise('UPDATE tasks SET state = 2 WHERE ?', { id }).then((results, fields) => {
      socket.emit('task removed', id).to('project ' + pid).emit('task removed', id)
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '移除任务出错')
    })
  })

  /**
   * 完成任务
   */
  socket.on('toggletask', ({ id, state, pid }) => {
    pool.promise('UPDATE tasks SET state = ? WHERE id = ?', [ state, id ]).then((results, fields) => {
      socket.emit('task toggled', id, state).to('project ' + pid).emit('task toggled', id, state)
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '标记任务出错')
      return
    })
  })

  /**
   * 更新项目
   */
  socket.on('updateproject', ({ pid, pname, shares }) => {
    pool.promise('UPDATE projects SET name = ? WHERE id = ?', [ pname, pid ]).then(results => {
      socket.emit('project updated', {
        id: pid,
        name: pname
      })
      return pool.promise('SELECT uid FROM shares WHERE pid = ?', [ pid ])
    }).then(results => {
      console.debug('unshared project event')
      const old_uids = results.map(row => row.uid)
      const new_uids = shares.map(share => share.uid)
      return Promise.all(old_uids.map(uid => {
        // 收回共享
        if (new_uids.indexOf(uid) === -1) {
          console.log('unshared with %d', uid)
          return pool.promise('DELETE FROM shares WHERE pid = ? AND uid = ?', [pid, uid]).then(results => {
            if (sockets[uid]) {
              sockets[uid].forEach(s => {
                s.emit('project unshared', pid).leave('project ' + pid)
              })
            }
            return Promise.resolve()
          })
        }
      }))
    }).then(() => {
      console.debug('add new user if not existed')
      return Promise.all(shares.map(share => {
        if (share.uid !== 0) {
          return Promise.resolve(share.uid)
        } else {
          return pool.promise('SELECT id FROM users WHERE tel = ?', [ share.tel ]).then(results => {
            if (results.length === 0) {
              // 添加新用户
              return pool.promise('INSERT INTO users SET ?', { tel: share.tel }).then(results => {
                return Promise.resolve(results.insertId)
              })
            } else {
              return Promise.resolve(results[0].id)
            }
          })
        }
      }))
    }).then(uids => {
      console.debug('add new share relationship %s', uids)
      return Promise.all(uids.map((uid) => {
        return pool.promise('SELECT 1 FROM shares WHERE pid = ? AND uid = ?', [pid, uid]).then(results => {
          if (results.length === 0) {
            return pool.promise('INSERT INTO shares SET ?', { pid, uid }).then(results => {
              return Promise.resolve(uid)
            })
          } else {
            return Promise.resolve(uid)
          }
        })
      }))
    }).then(uids => {
      console.debug('share project event')
      uids.forEach(uid => {
        if (sockets[uid]) {
          sockets[uid].forEach(s => {
            s.emit('project shared', pid).join('project ' + pid)
          })
        }
      })
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '更新项目出错')
    })
  })

  /**
   * 更新任务
   */
  socket.on('updatetask', ({ id, pid, content, notify_date }) => {
    if (notify_date === '') {
      notify_date = null
    }
    pool.promise('UPDATE tasks SET content = ?, notify_date = ? WHERE id = ?', [content, notify_date, id]).then(results => {
      socket.emit('task updated', {
        id,
        content,
        notify_date
      }).to('project ' + pid).emit('task updated', {
        id,
        content,
        notify_date
      })
    }).catch(err => {
      console.error(err)
      socket.emit('error event', '更新任务出错')
    })
  })

  /**
   * 断开链接
   */
  socket.on('disconnect', () => {
    console.log('user %d disconnected', uid)
    sockets[uid] = sockets[uid].filter(s => s.id !== socket.id)
    if (sockets[uid].length === 0)
      delete sockets[uid]
    console.log(sockets)
  })
})

http.listen(3000, () => {
  console.log('listening on *:3000')
})