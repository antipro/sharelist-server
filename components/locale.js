const i18n = {
  en: {
    'id': 'ID',
    'project': 'Project',
    'state': 'Status',
    'content': 'Content',
    'ctime': 'Created Time',
    'notify_date': 'Notify Date',
    'notify_time': 'Notify Time',
    'finished': 'Finished',
    'unfinished': 'Unfinished',
    'deleted': 'Deleted'
  },
  'zh-CN': {
    'id': 'ID',
    'project': '项目',
    'state': '状态',
    'content': '内容',
    'ctime': '创建时间',
    'notify_date': '通知日期',
    'notify_time': '通知时间',
    'finished': '已完成',
    'unfinished': '未完成',
    'deleted': '已删除'
  }
}

module.exports = function (locale, msg) {
  if (i18n[locale] === undefined) {
    locale = 'en'
  }
  return i18n[locale][msg]
}
