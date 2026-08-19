// components/timeline-card/timeline-card.js - 编辑 + 删除按钮
Component({
  properties: {
    record: {
      type: Object,
      value: {}
    },
    index: {
      type: Number,
      value: 0
    }
  },

  methods: {
    handleDelete() {
      wx.showModal({
        title: '删除记录',
        content: `确定删除这条${this.data.record.label}记录？`,
        confirmText: '删除',
        confirmColor: '#E8554E',
        success: (res) => {
          if (res.confirm) {
            this.triggerEvent('delete', { id: this.data.record._id })
          }
        }
      })
    },

    handleEdit() {
      this.triggerEvent('edit', { record: this.data.record })
    },

    handleCardTap() {
      // 卡片点击预留扩展位
    }
  }
})
