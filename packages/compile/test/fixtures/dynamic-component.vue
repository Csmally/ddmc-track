<template>
	<view>
		<component :is="currentTab"></component>
		<some-widget title="x"></some-widget>
	</view>
</template>
