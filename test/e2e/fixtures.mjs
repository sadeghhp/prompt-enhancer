/** Seed data for the smoke run: providers plus a few shaped sessions. */

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '

export const PROVIDERS = [
  {
    id: 'p1',
    name: 'Mock',
    baseUrl: 'http://localhost:4174/v1',
    apiKey: 'k',
    defaultModelId: 'm-slow',
    models: [
      { id: 'm-slow', modelId: 'slow', label: '' },
      { id: 'm-fail', modelId: 'fail', label: '' },
      { id: 'm-hang', modelId: 'hang', label: '' },
      { id: 'm-split', modelId: 'split', label: '' },
    ],
  },
]

function settings(modelId) {
  return {
    providerId: 'p1',
    modelId,
    outputLanguage: 'English',
    outputFormat: 'markdown',
    options: {
      clarity: true,
      structure: true,
      bestPractices: true,
      tokenEfficiency: true,
      preserveIntent: true,
      brevity: false,
      commentary: false,
    },
    target: { platform: '', model: '', type: '', bestPracticeIds: [] },
  }
}

export function column(id, text, modelId = 'm-slow', extra = {}) {
  return {
    id,
    text,
    instruction: '',
    settings: settings(modelId),
    createdAt: 1,
    producedBy: '',
    reasoning: '',
    reasoningSeconds: 0,
    ...extra,
  }
}

export function session(id, links, modelId = 'm-slow', title = id) {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 1,
    viewIndex: 0,
    starred: false,
    pinned: false,
    archived: false,
    chain: Array.from({ length: links }, (_, i) =>
      column(`${id}-c${i}`, `${title} link ${i + 1}\n\n${LOREM.repeat(25)}`, modelId, {
        reasoning: i ? 'reasoning '.repeat(1500) : '',
      }),
    ),
  }
}

export const SESSIONS = [
  session('big', 20, 'm-slow', 'Big chain'),
  session('four', 4, 'm-fail', 'Four links'),
  session('cancel', 2, 'm-slow', 'Cancel me'),
  ...Array.from({ length: 12 }, (_, i) => session(`filler${i}`, 6, 'm-slow', `Filler ${i}`)),
]
