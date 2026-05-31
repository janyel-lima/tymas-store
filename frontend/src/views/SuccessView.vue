<script setup lang="ts">
import {
  Check,
  ChevronRight,
  Moon,
  Receipt,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  User
} from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { isDark, toggleTheme } from '../theme';

const route = useRoute();

const planNames: Record<string, string> = {
  '7': 'Plano Bronze (7 Dias)',
  '14': 'Plano Prata (14 Dias)',
  '30': 'Plano Ouro (30 Dias)'
};

const planValues: Record<string, string> = {
  '7': 'R$ 30,00',
  '14': 'R$ 50,00',
  '30': 'R$ 100,00'
};

const userId = ref('');
const plano = ref('14');
const botUsername = ref('');

onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const getParam = (key: string): string => {
    return String(route.query[key] || urlParams.get(key) || '');
  };

  const parsedUserId =
    getParam('userId') ||
    getParam('id') ||
    getParam('chat_id') ||
    getParam('chatId') ||
    getParam('telegramId') ||
    getParam('telegram_id');

  userId.value = parsedUserId || 'Usuário do Telegram';

  const parsedPlano = getParam('plano') || getParam('plan');
  if (parsedPlano) plano.value = parsedPlano;

  // FIX: o backend agora passa ?bot=username na back_url de sucesso.
  // Caso não venha (acesso direto à rota), usa VITE_BOT_USERNAME como fallback
  // para que o botão "Voltar ao Telegram" sempre funcione corretamente.
  const parsedBot = getParam('bot');
  botUsername.value = parsedBot || import.meta.env.VITE_BOT_USERNAME || '';
});

// FIX: antes, se botUsername ficasse vazio (sem ?bot= na URL e sem VITE_BOT_USERNAME),
// o link ia para 'https://t.me' — a página inicial do Telegram, sem abrir o bot.
const telegramBotUrl = computed(() => {
  const botName = botUsername.value.trim();
  if (!botName) return 'https://t.me';
  if (botName.startsWith('http')) return botName;
  const cleanUsername = botName.replace('@', '');
  return `https://t.me/${cleanUsername}`;
});

const currentDateString = ref('');

onMounted(() => {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  currentDateString.value = new Date().toLocaleDateString('pt-BR', options);
});
</script>

<template>
  <div id="success-view" :class="[
    'min-h-screen flex flex-col items-center justify-center p-4 font-sans select-none antialiased relative overflow-hidden transition-colors duration-300',
    isDark ? 'bg-neutral-950 text-neutral-100' : 'bg-neutral-50 text-neutral-900'
  ]">

    <!-- Theme Toggle -->
    <div class="absolute top-4 right-4 z-40">
      <button @click="toggleTheme" :class="[
        'p-2.5 rounded-full border transition-all cursor-pointer flex items-center justify-center shadow-sm',
        isDark
          ? 'bg-neutral-900 border-neutral-800 text-amber-400 hover:bg-neutral-800'
          : 'bg-white border-neutral-200 text-indigo-600 hover:bg-neutral-100'
      ]" title="Alternar Tema">
        <Sun v-if="isDark" class="h-5 w-5" />
        <Moon v-else class="h-5 w-5" />
      </button>
    </div>

    <!-- Background decor -->
    <div v-if="isDark"
      class="absolute -top-40 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none">
    </div>
    <div v-if="isDark"
      class="absolute -bottom-40 left-1/2 -translate-x-1/2 w-96 h-96 bg-sky-500/5 rounded-full blur-[120px] pointer-events-none">
    </div>

    <!-- Main Card -->
    <div :class="[
      'w-full max-w-md border rounded-3xl p-6 shadow-2xl z-10 flex flex-col items-center text-center relative overflow-hidden transition-all duration-300',
      isDark ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200'
    ]">
      <div
        class="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/20 via-emerald-400 to-sky-500/20">
      </div>

      <!-- Animated Success Badge -->
      <div class="relative mb-6">
        <div class="absolute inset-0 bg-emerald-400/20 rounded-full blur-xl scale-125 animate-pulse"></div>
        <div :class="[
          'h-20 w-20 rounded-full flex items-center justify-center border-2 border-emerald-400 relative z-10 duration-300 transition-colors',
          isDark ? 'bg-neutral-950 shadow-[0_0_20px_rgba(52,211,153,0.3)]' : 'bg-emerald-50 shadow-[0_4px_15px_rgba(52,211,153,0.2)]'
        ]">
          <Check class="h-10 w-10 text-emerald-500 stroke-[3]" />
        </div>
      </div>

      <span
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-bold text-emerald-500 tracking-wider uppercase mb-3">
        <Sparkles class="h-3 w-3 shrink-0" />
        Pagamento Confirmado
      </span>

      <h1 :class="['text-2xl font-black tracking-tight mb-2', isDark ? 'text-white' : 'text-neutral-900']">Sucesso
        Confirmado!</h1>
      <p :class="['text-xs leading-relaxed mb-6 max-w-sm', isDark ? 'text-neutral-300' : 'text-neutral-600']">
        Pagamento Concluído! Seu acesso está sendo liberado no Telegram neste exato momento.
      </p>

      <!-- Digital Receipt -->
      <div :class="[
        'w-full rounded-2xl p-4 border text-left mb-6 relative',
        isDark ? 'bg-neutral-950 border-neutral-800' : 'bg-neutral-50 border-neutral-200'
      ]">
        <div
          :class="['flex items-center gap-2 mb-3 pb-3 border-b', isDark ? 'border-neutral-800/80' : 'border-neutral-200']">
          <Receipt class="h-4 w-4 text-neutral-400 shrink-0" />
          <span
            :class="['text-xs font-bold uppercase tracking-wider', isDark ? 'text-neutral-300' : 'text-neutral-600']">Recibo
            do Cliente</span>
        </div>

        <div class="space-y-2.5 text-xs text-neutral-400">
          <div class="flex items-center justify-between">
            <span>ID do Usuário:</span>
            <span
              :class="['font-mono font-semibold flex items-center gap-1', isDark ? 'text-neutral-200' : 'text-neutral-800']">
              <User class="h-3 w-3 inline text-neutral-500" />
              {{ userId }}
            </span>
          </div>

          <div class="flex items-center justify-between">
            <span>Plano Adquirido:</span>
            <span :class="['font-bold', isDark ? 'text-neutral-200' : 'text-neutral-800']">
              {{ planNames[plano] || 'Plano Personalizado' }}
            </span>
          </div>

          <div class="flex items-center justify-between">
            <span>Valor Total:</span>
            <span class="text-emerald-500 font-black">
              {{ planValues[plano] || 'R$ ' + plano }}
            </span>
          </div>

          <div class="flex items-center justify-between">
            <span>Data & Hora:</span>
            <span :class="[isDark ? 'text-neutral-300' : 'text-neutral-700']">
              {{ currentDateString }}
            </span>
          </div>

          <div
            :class="['flex items-center justify-between border-t border-dashed pt-2.5 mt-2.5', isDark ? 'border-neutral-800/80' : 'border-neutral-200']">
            <span>Status da Liberação:</span>
            <span class="font-bold text-sky-500 flex items-center gap-1 relative overflow-hidden">
              <span class="h-2 w-2 rounded-full bg-sky-500 inline-block animate-ping absolute"></span>
              <span class="h-2 w-2 rounded-full bg-sky-500 inline-block mr-1"></span>
              Ativando via Bot...
            </span>
          </div>
        </div>
      </div>

      <!-- CTA Button -->
      <a :href="telegramBotUrl" target="_blank" rel="noopener noreferrer" :class="[
        'w-full font-black text-sm py-4 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer group',
        isDark
          ? 'bg-emerald-500 hover:bg-emerald-400 text-neutral-950 shadow-[0_4px_15px_rgba(52,211,153,0.25)] hover:shadow-[0_4px_25px_rgba(52,211,153,0.4)]'
          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_15px_rgba(16,185,129,0.2)] hover:shadow-[0_4px_25px_rgba(16,185,129,0.35)]'
      ]">
        <Send class="h-4.5 w-4.5 fill-current" />
        Voltar para o Telegram
        <ChevronRight class="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
      </a>

      <p :class="['text-[10px] mt-4 leading-normal', isDark ? 'text-neutral-500' : 'text-neutral-400']">
        Caso seu bot não responda imediatamente, envie o comando <code
          :class="['font-mono px-1 py-0.5 rounded border text-sky-500', isDark ? 'bg-neutral-950 border-neutral-800' : 'bg-neutral-100 border-neutral-200']">/start</code>
        nele para atualizar as credenciais.
      </p>
    </div>

    <!-- Trust Footer -->
    <div :class="['mt-6 flex items-center gap-1.5 text-xs z-10', isDark ? 'text-neutral-500' : 'text-neutral-400']">
      <ShieldCheck class="h-4 w-4 text-emerald-500" />
      <span>Ambiente de Segurança de Dados Ativa</span>
    </div>
  </div>
</template>

<style scoped>
@keyframes pulseGlow {

  0%,
  100% {
    transform: scale(1.1);
    opacity: 0.15;
  }

  50% {
    transform: scale(1.35);
    opacity: 0.35;
  }
}

.animate-pulse {
  animation: pulseGlow 2.5s infinite ease-in-out;
}
</style>
