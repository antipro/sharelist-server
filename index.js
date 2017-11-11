var app = require('express')()
var http = require('http').Server(app)
var io = require('socket.io')(http, { origins: '*:*' })

const pool = require('mysql').createPool({
  host     : 'localhost',
  user     : 'antipro',
  password : '385471c54e',
  database : 'sharelist',
  multipleStatements: true
})

app.all("*", function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header("Access-Control-Allow-Headers", "Content-Type,Content-Length, Authorization, Accept,X-Requested-With");
  res.header("Access-Control-Allow-Methods","PUT,POST,GET,DELETE,OPTIONS");
  next();
});
app.get('/api/login', (req, res) => {
  pool.query('SELECT id AS uid, tel, token, name AS uname FROM users WHERE tel = ? AND pwd = SHA1(?)', [req.query.tel, req.query.pwd], (err, rows, fields) => {
    if (err) {
      console.log(err)
      res.send({
        state: '001',
        msg: `登录出错：${err}`
      })
      return
    }
    console.log(rows)
    if (rows.length === 0) {
      res.send({
        state: '001',
        msg: '用户不存在'
      })
    } else {
      res.send({
        state: '000',
        msg: '',
        data: rows[0]
      })
    }
  })
})

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

  let sql1 = 'SELECT id, uid, content, pid, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(notify_date, \'%Y-%m-%d\') AS notify_date FROM items WHERE uid = ' + uid
  let sql2 = 'SELECT id, uid, name, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, editable FROM projects WHERE uid = ' + uid
  pool.query(sql1 + ';' + sql2, (err, results, fields) => {
    if (err) {
      console.log(err)
      socket.emit('error', '查询项目出错')
      return
    }
    let items = results[0]
    let projects = results[1]
    socket.emit('init', {
      items,
      projects
    })
  });

  // pool.query('SELECT id, uid, content, pid, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(notify_date, \'%Y-%m-%d\') AS notify_date FROM items WHERE uid = ?', [ uid ], (err, rows, fields) => {
  //   if (err) {
  //     console.log(err)
  //     socket.emit('error', '查询条目出错')
  //     return
  //   }
  //   socket.emit('items', rows)
  // })

  // pool.query('SELECT id, uid, name, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, editable FROM projects WHERE uid = ?', [ uid ], (err, rows, fields) => {
  //   if (err) {
  //     console.log(err)
  //     socket.emit('error', '查询项目出错')
  //     return
  //   }
  //   socket.emit('projects', rows)
  // });
  
  /**
   * 新增条目
   */
  socket.on('addnewitem', ({ pid, uid, content }) => {
    pool.query('INSERT INTO items SET ?', { uid, pid, content }, (err, results, fields) => {
      if (err) {
        console.log(err)
        socket.emit('error', '新增条目出错')
        return
      }
      let id = results.insertId
      pool.query('SELECT id, uid, content, pid, DATE_FORMAT(ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, DATE_FORMAT(notify_date, \'%Y-%m-%d\') AS notify_date FROM items WHERE id = ?', id, (err, rows, fields) => {
        if (err) {
          console.log(err)
          socket.emit('error', '查询条目出错')
          return
        }
        
        socket.emit('newitem', rows[0])
        socket.broadcast.emit('newitem', rows[0])
      })
    })
  })
  
  /**
   * 断开链接
   */
  socket.on('disconnect', () => {
    console.log('user %d disconnected', uid)
  })
})

http.listen(3000, () => {
  console.log('listening on *:3000')
})