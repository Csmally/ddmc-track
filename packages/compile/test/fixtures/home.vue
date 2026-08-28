<template>
	<page-content>
		<view class="home">
			<search-bar @search="handleSearch"></search-bar>
			<banner-swiper :banners="banners" @click="handleBannerClick"></banner-swiper>
			<banner-swiper :banners="banners" @click="handleBannerClick"></banner-swiper>
			<nav-grid :list="navList" @item-click="handleNavClick" v-for="(item, i) in arr1" :key="i"></nav-grid>
			<section-header title="为你推荐" @more="handleMore" v-for="item in arr2" :key="item"></section-header>
			<goods-grid :list="goodsList" @goods-click="handleGoodsClick" @add-cart="handleAddCart"></goods-grid>
		</view>
	</page-content>
</template>

<script>
	import { getGoodsList, getBanners } from '@/api/goods'

	export default {
		name: 'homePage',
		data() {
			return {
				goodsList: [],
				banners: [],
				navList: [
					{ name: '限时秒杀', icon: '秒', url: '' },
					{ name: '新品首发', icon: '新', url: '' },
					{ name: '热卖榜单', icon: '榜', url: '/pages/ranking/ranking' },
					{ name: '全部分类', icon: '类', url: '/pages/category/category' }
				],
				arr1: [0, 1, 2],
				arr2: [0, 1]
			}
		},
		onLoad() {
			console.log('9898 home onLoad')
			this.loadData()
		},
		methods: {
			async loadData() {
				try {
					const [banners, goodsRes] = await Promise.all([getBanners(), getGoodsList()])
					this.banners = banners
					this.goodsList = goodsRes.list
				} catch (e) {
					// 网络错误 request 层已 toast；这里兜底接口错误
					if (e && e.data && e.data.message) {
						uni.showToast({ title: e.data.message, icon: 'none' })
					}
				}
			},
			handleSearch(keyword) {
				if (!keyword.trim()) {
					uni.showToast({ title: '请输入搜索关键词', icon: 'none' })
					return
				}
				uni.navigateTo({ url: '/pages/searchResult/searchResult?keyword=' + encodeURIComponent(keyword.trim()) })
			},
			handleBannerClick(banner) {
				uni.showToast({ title: banner.title + '活动页开发中', icon: 'none' })
			},
			handleNavClick(item) {
				// tabBar 页面之间跳转必须用 switchTab
				if (item.url) {
					uni.switchTab({ url: item.url })
				} else {
					uni.showToast({ title: item.name + '开发中', icon: 'none' })
				}
			},
			handleMore() {
				uni.showToast({ title: '更多商品开发中', icon: 'none' })
			},
			handleGoodsClick(goods) {
				uni.navigateTo({ url: '/pages/goodsDetail/goodsDetail?id=' + goods.id })
			},
			handleAddCart(goods) {
				this.$store.dispatch('cart/addGoods', goods)
			}
		}
	}
</script>

<style scoped>
	.home {
		padding-bottom: 20rpx;
	}
</style>
