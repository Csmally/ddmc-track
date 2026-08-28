<template>
	<view class="goods-grid">
		<view
			v-for="item in list"
			:key="item.id"
			class="goods-grid__cell"
		>
			<goods-card
				:goods="item"
				@click="$emit('goods-click', item)"
				@add-cart="$emit('add-cart', item)"
			></goods-card>
		</view>
	</view>
</template>

<script>
	export default {
		name: 'goodsGrid',
		props: {
			// 商品数组
			list: {
				type: Array,
				default: () => []
			}
		}
	}
</script>

<style scoped>
	.goods-grid {
		padding: 0 20rpx;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
	}

	.goods-grid__cell {
		width: 48%;
		margin-bottom: 20rpx;
	}
</style>
