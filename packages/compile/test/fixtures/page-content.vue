<template>
	<view class="page-content">
		<slot></slot>
	</view>
</template>

<script>
	export default {
		name: 'pageContent',
		mounted() {
			console.log('9898 page-content mounted', this.$parent.$options.name)
		}
	}
</script>

<style scoped>
	/* 页面统一容器：占满一屏，背景与 pages.json globalStyle 保持一致 */
	.page-content {
		min-height: 100vh;
		background-color: #f8f8f8;
	}
</style>
