<script setup lang="ts">
import { ref } from 'vue'
import { useContentStore } from '@/stores/content'

const content = useContentStore()
const dismissed = ref(false)
</script>

<template>
  <div
    v-if="!dismissed"
    role="alert"
    class="relative bg-kteq-yellow px-4 py-2 text-center font-display text-sm font-medium text-kteq-black"
  >
    <component
      :is="content.settings.bannerUrl ? 'a' : 'span'"
      :href="content.settings.bannerUrl || undefined"
      class="hover:underline"
    >
      {{ content.settings.bannerText }}
    </component>
    <button
      v-if="content.settings.bannerDismissible"
      @click="dismissed = true"
      class="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
      aria-label="Dismiss announcement"
    >
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
a {
  color: var(--color-kteq-black);
}
a:hover {
  color: var(--color-kteq-gray);
}
</style>
