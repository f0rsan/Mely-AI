export const seed = {
  users: [
    { id: 'u_demo', email: 'demo@mely.ai', password: '123456', name: 'Demo User' }
  ],
  projects: [
    { id: 'p_alpha', name: 'Mely Copilot Alpha', ownerId: 'u_demo' },
    { id: 'p_beta', name: 'Vision Playground', ownerId: 'u_demo' }
  ],
  models: [
    { id: 'm_gpt4o', projectId: 'p_alpha', label: 'GPT-4o', provider: 'OpenAI' },
    { id: 'm_claude', projectId: 'p_alpha', label: 'Claude Sonnet', provider: 'Anthropic' },
    { id: 'm_flux', projectId: 'p_beta', label: 'FLUX Schnell', provider: 'Black Forest Labs' }
  ],
  sessions: [
    {
      id: 's_1',
      projectId: 'p_alpha',
      modelId: 'm_gpt4o',
      title: 'Kickoff Session',
      messages: [
        { id: 'msg_1', role: 'assistant', content: 'Welcome to Mely AI mock session.' }
      ]
    }
  ]
};
