<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <div class="min-h-screen bg-neutral-900 selection:bg-sky-500/30 selection:text-neutral-100">
    <!-- Render the active view using Vue Router -->
    <RouterView />
  </div>
</template>

<style>
/* Global stylesheet resets if any */
html, body {
  margin: 0;
  padding: 0;
  background-color: #171717; /* neutral-900 */
}
</style>
