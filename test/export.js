const { promisify } = require('util');
const fs = require('fs');
const writeFile = promisify(fs.writeFile);

let pool = require('../components/database')
let subject = 'Your account has been deleted, thanks for your kindness.'

;(async () => {
  try {
    const tasks = await pool.promise(`SELECT a.id, a.state, a.content, DATE_FORMAT(a.ctime, \'%Y-%m-%d %H:%i:%s\') AS ctime, 
      DATE_FORMAT(a.notify_date, \'%Y-%m-%d\') AS notify_date, DATE_FORMAT(a.notify_time, \'%H:%i\') AS notify_time, 
      b.name AS pname FROM tasks a 
      LEFT JOIN projects b ON a.pid = b.id 
      WHERE b.uid = 1 OR (a.pid = 0 AND a.uid = 1) ORDER BY a.pid, a.state, a.id`)
    
    const pug = require('pug')
    const i18n = require('../components/locale')
    let locale = 'en-GB'
    let html = pug.renderFile('./tpl/accountdeleted.pug', {
      subject,
      tasks,
      locale,
      i18n
    })
    
    await writeFile('./test/export.html', html)
    console.log('The file has been saved!');
    var c = require('child_process');
    c.exec('x-www-browser ./test/export.html');
    process.exit(0)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
