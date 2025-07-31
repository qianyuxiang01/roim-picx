import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: '/:folderName*',
			name: 'manage',
			component: () => import('../views/ManageImages.vue'),
			props: true
		},
		{
			path: '/up',
			component: () => import('../views/UploadImages.vue')
		},
		{
			path: '/auth',
			component: () => import('../views/auth.vue')
		},
		{
			path: '/:path(.*)',
			redirect: '/'
		}
	]
})

export default router
