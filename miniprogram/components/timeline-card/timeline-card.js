// components/timeline-card/timeline-card.js
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

  data: {
    startX: 0,
    offsetX: 0,
    isSwiping: false,
    showDelete: false
  },

  methods: {
    // 触摸开始
    handleTouchStart(e) {
      if (e.touches.length !== 1) return
      this.setData({
        startX: e.touches[0].clientX,
        isSwiping: true
      })
    },

    // 触摸移动
    handleTouchMove(e) {
      if (!this.data.isSwiping || e.touches.length !== 1) return
      const moveX = e.touches[0].clientX
      const diff = moveX - this.data.startX
      // 仅允许左滑
      if (diff < 0 && diff > -160) {
        this.setData({ offsetX: diff })
      }
    },

    // 触摸结束
    handleTouchEnd() {
      if (!this.data.isSwiping) return
      const offset = this.data.offsetX
      // 滑动超过一半则显示删除
      if (offset < -80) {
        this.setData({ offsetX: -140, showDelete: true })
      } else {
        this.setData({ offsetX: 0, showDelete: false })
      }
      this.setData({ isSwiping: false })
    },

    // 点击删除按钮
    handleDelete() {
      // 二次确认
      wx.showModal({
        title: '确认删除',
        content: `确定要删除这条${this.data.record.label}记录吗？`,
        confirmText: '删除',
        confirmColor: '#E8554E',
        success: (res) => {
          if (res.confirm) {
            this.triggerEvent('delete', { id: this.data.record._id })
          } else {
            // 取消则收回
            this.setData({ offsetX: 0, showDelete: false })
          }
        }
      })
    },

    // 恢复滑动
    handleCardTap() {
      if (this.data.showDelete) {
        this.setData({ offsetX: 0, showDelete: false })
      }
    }
  }
})
