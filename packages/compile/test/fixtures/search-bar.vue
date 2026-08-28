<template>
	<view :class="className">
		<input
			class="search-bar__input"
			type="text"
			:value="value"
			placeholder="搜索商品"
			confirm-type="search"
			@input="handleInput"
			@confirm="handleConfirm"
		/>
	</view>
</template>

<script>
	export default {
		name: 'searchBar',
		props: {
			value: {
				type: String,
				default: ''
			}
		},
		data() {
			return {
				className: 'search-bar'
			}
		},
		methods: {
			handleInput(e) {
				this.$emit('input', e.detail.value)
			},
			handleConfirm(e) {
				this.$emit('search', e.detail.value)
			}
		}
	}
</script>

<style scoped>
	.search-bar {
		padding: 16rpx 20rpx;
		background-color: #ffffff;
	}

	.search-bar__input {
		height: 64rpx;
		padding: 0 24rpx;
		border-radius: 32rpx;
		background-color: #f2f2f2;
		font-size: 26rpx;
		color: #333333;
	}
</style>
