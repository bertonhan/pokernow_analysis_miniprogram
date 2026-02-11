Component({
  data: {
    selected: 0, // 当前选中第几个
    color: "#7A7E83",
    selectedColor: "#07c160", // 选中时的颜色（微信绿）
    list: [{
      pagePath: "/pages/match/list/index",
      iconPath: "/images/match.png", 
      selectedIconPath: "/images/match_active.png",
      text: "对局"
    }, {
      pagePath: "/pages/player/index",
      iconPath: "/images/player.png",
      selectedIconPath: "/images/player_active.png",
      text: "选手"
    }, {
      pagePath: "/pages/profile/index",
      iconPath: "/images/profile.png",
      selectedIconPath: "/images/profile_active.png",
      text: "我的"
    }]
  },
  methods: {
    switchTab(e) {
      const data = e.currentTarget.dataset
      const url = data.path
      wx.switchTab({url})
      // 这里的 setData 其实在 switchTab 后会被页面重置，关键在页面的 onShow
      this.setData({ selected: data.index })
    }
  }
})