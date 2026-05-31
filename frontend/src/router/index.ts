import { createRouter, createWebHistory } from 'vue-router';
import CheckoutView from '../views/CheckoutView.vue';
import SuccessView from '../views/SuccessView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/checkout'
    },
    {
      path: '/checkout',
      name: 'checkout',
      component: CheckoutView
    },
    {
      path: '/sucesso',
      name: 'sucesso',
      component: SuccessView
    },
    // Fallback redirect support for common Success queries
    {
      path: '/success',
      redirect: '/sucesso'
    }
  ]
});

export default router;
