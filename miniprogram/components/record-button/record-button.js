// components/record-button/record-button.js
Component({
  properties: {
    type: {
      type: String,
      value: 'feed'  // feed | diaper | sleep
    },
    label: {
      type: String,
      value: ''
    },
    icon: {
      type: String,
      value: ''
    },
    color: {
      type: String,
      value: '#D4B896'
    },
    disabled: {
      type: Boolean,
      value: false
    },
    lastTime: {
      type: Number,
      value: 0
    },
    elapsedTime: {
      type: String,
      value: ''
    }
  },

  data: {
    pressing: false,
    showSuccess: false
  },

  methods: {
    handleTap() {
      if (this.data.disabled) return

      // 触感反馈
      wx.vibrateShort({ type: 'light' })

      // 按下动画
      this.setData({ pressing: true })
      setTimeout(() => this.setData({ pressing: false }), 300)

      // 显示成功反馈
      this.setData({ showSuccess: true })
      setTimeout(() => this.setData({ showSuccess: false }), 1200)

      // 触发自定义事件
      this.triggerEvent('tap', {
        type: this.data.type,
        timestamp: Date.now()
      })
    }
  }
})
