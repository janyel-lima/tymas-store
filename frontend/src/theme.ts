import { ref } from 'vue';

const savedTheme = localStorage.getItem('payment-theme');
// Default to dark mode is fine as requested, but user can toggle to light mode.
export const isDark = ref(savedTheme === null ? true : savedTheme === 'dark');

export function toggleTheme() {
  isDark.value = !isDark.value;
  localStorage.setItem('payment-theme', isDark.value ? 'dark' : 'light');
}
