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
    let projects = results[1]
    res.send({
      state: '000',
      msg: '',
      data: {
        tasks,
        projects
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
  sockets[uid] = socket

  let sql1 = `SELECT id, uid, content, pid, state, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(notify_date, \'%Y-%m-%d\') AS notify_date 
      FROM tasks WHERE uid = ${uid} AND state <> 2
      UNION
      SELECT b.id, b.uid, b.content, b.pid, b.state, DATE_FORMAT(b.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(b.notify_date, \'%Y-%m-%d\') AS notify_date 
      FROM shares a, tasks b WHERE a.uid = ${uid} AND a.pid = b.pid AND b.state <> 2`
  let sql2 = `SELECT id AS id, uid, name, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, editable, \'\' AS control 
      FROM projects WHERE uid = ${uid}
      UNION 
      SELECT b.id, b.uid, b.name, DATE_FORMAT(b.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, \'\' AS editable, a.control 
      FROM shares a, projects b WHERE a.uid = ${uid} AND a.pid = b.id`
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
      socket.emit('task added', results[0]).to('project ' + pid).emit('newtask', results[0])
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '新增任务出错')
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
      return pool.promise('SELECT uid FROM shares WHERE pid = ?', [ pid ])
    }).then((results, fields) => {
      const old_uids = results.map(row => row.uid)
      const new_uids = shares.map(share => share.uid)
      old_uids.forEach(uid => {
        // 收回共享
        if (new_uids.indexOf(uid) === -1 && sockets[uid]) {
          sockets[uid].emit('project unshared', pid).leave('project ' + pid)
        }
      })
      return pool.promise('DELETE FROM shares WHERE pid = ?', [ pid ])
    }).then(() => {
      shares.forEach(share => {
        console.log('share project with %s', share.tel)
        // 老分享用户
        if (share.uid !== 0) {
          pool.query('INSERT INTO shares SET ?', { pid, uid: share.uid })
          if (sockets[share.uid]) {
            sockets[share.uid].emit('project shared', pid).join('project ' + pid)
          }
          return
        }
        // 新分享用户
        pool.promise('SELECT id FROM users WHERE tel = ?', [ share.tel ]).then(results => {
          if (results.length === 0) {
            // 添加新用户
            return pool.promise('INSERT INTO users SET ?', { tel: share.tel }).then(results => {
              return results.insertId
            })
          } else {
            return results[0].id
          }
        }).then(uid =>{
          pool.query('INSERT INTO shares SET ?', { pid, uid })
          if (sockets[uid]) {
            sockets[uid].emit('project shared', pid).join('project ' + pid)
          }
          return uid
        })
      })
    }).catch((err) => {
      console.error(err)
      socket.emit('error event', '更新项目出错')
    })
  })

  /**
   * 断开链接
   */
  socket.on('disconnect', () => {
    console.log('user %d disconnected', uid)
    delete sockets[uid]
  })
})

http.listen(3000, () => {
  console.log('listening on *:3000')
})