// custom-tab-bar/index.js - 自定义底部导航
Component({
  data: {
    selected: 0,
    color: '#B5A795',
    selectedColor: '#D4B896',
    list: [
      {
        pagePath: '/pages/index/index',
        text: '记录',
        icon: '/images/tab-record.png',
        iconActive: '/images/tab-record-active.png'
      },
      {
        pagePath: '/pages/timeline/timeline',
        text: '时光',
        icon: '/images/tab-timeline.png',
        iconActive: '/images/tab-timeline-active.png'
      },
      {
        pagePath: '/pages/growth/growth',
        text: '成长',
        icon: '/images/tab-growth.png',
        iconActive: '/images/tab-growth-active.png'
      },
      {
        pagePath: '/pages/schedule/schedule',
        text: '日程',
        icon: '/images/tab-schedule.png',
        iconActive: '/images/tab-schedule-active.png'
      }
    ]
  },

  methods: {
    /**
     * 外部页面调用此方法同步选中态
     */
    switchTab(target) {
      const idx = this.data.list.findIndex(item => item.pagePath === '/' + target)
      if (idx >= 0 && idx !== this.data.selected) {
        this.setData({ selected: idx })
      }
    },

    /**
     * 点击 tab
     */
    onTap(e) {
      const { index } = e.currentTarget.dataset
      const item = this.data.list[index]
      if (!item) return

      // 使用 switchTab 跳转（保留 tabBar 切换动画）
      wx.switchTab({
        url: item.pagePath,
        success: () => {
          this.setData({ selected: index })
        }
      })
    }
  }
})
