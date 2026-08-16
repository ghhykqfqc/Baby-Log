// utils/constants.js - 常量定义

const RECORD_TYPES = {
  FEED: 'feed',
  DIAPER: 'diaper',
  SLEEP: 'sleep'
}

const RECORD_CONFIG = {
  feed: {
    label: '喂奶',
    icon: '🍼',
    color: '#F5C6A0',
    colorDark: '#E89B5F',
    unit: 'ml'
  },
  diaper: {
    label: '换尿布',
    icon: '🧷',
    color: '#B8D4D0',
    colorDark: '#7AAFA8'
  },
  sleep: {
    label: '睡觉',
    icon: '🌙',
    color: '#C7B8D9',
    colorDark: '#8B7AAA',
    unit: 'min'
  }
}

const FAMILY_ROLES = {
  PARENT: 'parent',
  GRANDPARENT: 'grandparent'
}

const ROLE_LABELS = {
  parent: '父母（可编辑）',
  grandparent: '祖辈（仅查看）'
}

module.exports = {
  RECORD_TYPES,
  RECORD_CONFIG,
  FAMILY_ROLES,
  ROLE_LABELS
}
