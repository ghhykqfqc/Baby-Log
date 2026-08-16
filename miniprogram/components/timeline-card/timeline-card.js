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
    handleTouchStart(e) {
      if (e.touches.length !== 1) return
      this.setData({ startX: e.touches[0].clientX, isSwiping: true })
    },

    handleTouchMove(e) {
      if (!this.data.isSwiping || e.touches.length !== 1) return
      const moveX = e.touches[0].clientX
      const diff = moveX - this.data.startX
      // 仅允许左滑，且最大 160rpx（折算 px）
      if (diff < 0 && diff > -100) {
        this.setData({ offsetX: diff })
      }
    },

    handleTouchEnd() {
      if (!this.data.isSwiping) return
      const offset = this.data.offsetX
      if (offset < -40) {
        this.setData({ showDelete: true, offsetX: 0 })
      } else {
        this.setData({ showDelete: false, offsetX: 0 })
      }
      this.setData({ isSwiping: false })
    },

    handleDelete() {
      wx.showModal({
        title: '确认删除',
        content: `确定删除这条${this.data.record.label}记录？`,
        confirmText: '删除',
        confirmColor: '#E8554E',
        success: (res) => {
          if (res.confirm) {
            this.triggerEvent('delete', { id: this.data.record._id })
          } else {
            this.setData({ showDelete: false })
          }
        }
      })
    },

    handleCardTap() {
      if (this.data.showDelete) {
        this.setData({ showDelete: false })
      }
    }
  }
})
