<template>
	<view class="page">
		<promo-banner v-if="a" title="A"></promo-banner>
		<promo-banner v-else-if="b" title="B"></promo-banner>
		<promo-banner v-else title="C"></promo-banner>
	</view>
</template>
