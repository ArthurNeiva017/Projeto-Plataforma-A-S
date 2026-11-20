const byId = (id) => document.getElementById(id);
const initialMessages = {
  geral: [['Bia', 'lilac', '19:04', 'Boa noite! Alguém anima uma partida hoje?'], ['Rafa', 'peach', '19:06', 'Eu topo! Entro no Lounge daqui a pouco.']],
  avisos: [['Bia', 'lilac', '18:30', 'Bem-vindos! Vamos usar este canal para combinar os próximos encontros.']],
  jogos: [['Rafa', 'peach', '18:45', 'Qual jogo vocês querem jogar no fim de semana?']],
};
const storageKey = 'ponto-de-encontro-v1';
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
} catch {}
const preferences = {
  name: 'Você', avatar: '', avatarShape: 'square', bio: '', status: 'available',
  density: 'comfortable', textSize: 'standard', screenAudio: false, noiseSuppression: true, echoCancellation: true,
  workspace: 'Ponto de Encontro', description: 'Comunidade privada', symbol: '✳',
  roomStyle: 'grid', defaultChannel: 'geral', welcome: '', ...saved.preferences,
};
const statuses = {available: 'Disponível', away: 'Ausente', busy: 'Não perturbe'};
const textChannels = Object.assign(Object.create(null), saved.textChannels || initialMessages);
const voiceRooms = saved.voiceRooms || ['Lounge', 'Partida'];
const members = saved.members || [{name: 'Bia', status: 'Perfil de demonstração'}, {name: 'Rafa', status: 'Perfil de demonstração'}];
const capacity = 10;
let activeText = Object.hasOwn(textChannels, preferences.defaultChannel) ? preferences.defaultChannel : Object.keys(textChannels)[0];
let activeVoice = voiceRooms[0];
let viewingVoice = false;
let joined = false;
let microphone;
let display;
let pending = false;
let roomSession = 0;

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({preferences, textChannels, voiceRooms, members}));
    return true;
  } catch {
    return false;
  }
}

function addChannel(label, icon, select) {
  const button = document.createElement('button');
  const symbol = document.createElement('span');
  symbol.textContent = icon;
  symbol.setAttribute('aria-hidden', 'true');
  button.className = 'channel';
  button.append(symbol, label);
  button.addEventListener('click', () => {
    select();
    document.querySelector('.sidebar').classList.remove('open');
    byId('menu').setAttribute('aria-expanded', 'false');
    render();
  });
  byId('channels').append(button);
  return button;
}

const textButtons = Object.create(null);
const voiceButtons = Object.create(null);
function addHeading(label, kind) {
  const group = document.createElement('div');
  const heading = document.createElement('h2');
  const button = document.createElement('button');
  group.className = 'channel-heading';
  heading.textContent = label;
  button.type = 'button';
  button.textContent = '+';
  button.setAttribute('aria-label', `Criar canal de ${kind === 'text' ? 'texto' : 'voz'}`);
  button.addEventListener('click', () => openChannelPanel(kind));
  group.append(heading, button);
  byId('channels').append(group);
}
function renderChannels() {
  byId('channels').replaceChildren();
  addHeading('CANAIS DE TEXTO', 'text');
  for (const name of Object.keys(textChannels)) {
    textButtons[name] = addChannel(name, '#', () => {
      activeText = name;
      viewingVoice = false;
    });
  }
  addHeading('CANAIS DE VOZ', 'voice');
  for (const name of voiceRooms) {
    voiceButtons[name] = addChannel(name, '◖', () => {
      if (name !== activeVoice) leaveRoom();
      activeVoice = name;
      viewingVoice = true;
    });
  }
}

function renderMessages() {
  const log = byId('messages');
  log.replaceChildren();
  for (const [name, color, time, message] of textChannels[activeText]) {
    const item = document.createElement('article');
    const avatar = document.createElement('span');
    const details = document.createElement('div');
    const author = document.createElement('strong');
    const timestamp = document.createElement('time');
    const body = document.createElement('p');
    avatar.className = `avatar ${color}`;
    avatar.textContent = name[0];
    avatar.setAttribute('aria-hidden', 'true');
    author.textContent = name;
    timestamp.textContent = time;
    body.textContent = message;
    details.append(author, timestamp, body);
    item.append(avatar, details);
    log.append(item);
  }
  log.scrollTop = log.scrollHeight;
  const count = textChannels[activeText].length;
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'empty-chat';
    empty.textContent = 'Comece a conversa com a primeira mensagem.';
    log.append(empty);
  }
  byId('chat-count').textContent = `${count} ${count === 1 ? 'mensagem' : 'mensagens'}`;
}

function renderVoice() {
  byId('voice-name').textContent = activeVoice;
  byId('voice-count').textContent = `${joined ? 1 : 0} de ${capacity} na sala`;
  byId('presence').textContent = joined ? `${statuses[preferences.status]} · Na sala ${activeVoice}` : statuses[preferences.status];
  byId('join').textContent = joined ? 'Sair da sala' : 'Entrar na sala';
  byId('mic').hidden = !joined;
  byId('mic').disabled = pending;
  byId('mic').textContent = microphone ? 'Silenciar microfone' : 'Ativar microfone';
  byId('share').hidden = !joined;
  byId('share').disabled = pending;
  byId('share').textContent = display ? 'Parar compartilhamento' : 'Compartilhar tela';
}

function render() {
  byId('brand-name').textContent = preferences.workspace;
  byId('brand-icon').textContent = preferences.symbol;
  byId('brand-description').textContent = preferences.description;
  byId('profile-name').textContent = preferences.name;
  byId('profile-bio').textContent = preferences.bio;
  byId('profile-bio').hidden = !preferences.bio;
  byId('profile-status').textContent = statuses[preferences.status];
  byId('member-name').textContent = preferences.name;
  for (const id of ['profile-avatar', 'member-avatar']) {
    const avatar = byId(id);
    avatar.textContent = preferences.avatar || Array.from(preferences.name)[0].toLocaleUpperCase('pt-BR');
    avatar.classList.toggle('round', preferences.avatarShape === 'round');
  }
  document.body.classList.toggle('compact', preferences.density === 'compact');
  document.body.classList.toggle('large-chat', preferences.textSize === 'large');
  byId('room').classList.toggle('plain-room', preferences.roomStyle === 'plain');
  const welcome = byId('welcome');
  welcome.textContent = preferences.welcome;
  welcome.hidden = !preferences.welcome || viewingVoice || activeText !== preferences.defaultChannel;
  renderMembers();
  byId('title').textContent = viewingVoice ? activeVoice : `# ${activeText}`;
  byId('subtitle').textContent = viewingVoice ? 'Sala de voz' : 'Canal de texto';
  byId('chat-title').textContent = `# ${activeText}`;
  byId('message').placeholder = `Escreva em #${activeText}`;
  for (const [name, button] of Object.entries(textButtons)) {
    button.setAttribute('aria-current', String(!viewingVoice && activeText === name));
  }
  for (const [name, button] of Object.entries(voiceButtons)) {
    button.setAttribute('aria-current', String(viewingVoice && activeVoice === name));
  }
  renderVoice();
  renderMessages();
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function stopSharing() {
  stopStream(display);
  display = undefined;
  byId('screen').srcObject = null;
  byId('screen').hidden = true;
}

function leaveRoom() {
  roomSession += 1;
  joined = false;
  stopStream(microphone);
  microphone = undefined;
  stopSharing();
  byId('status').textContent = '';
}

byId('join').addEventListener('click', () => {
  if (joined) {
    leaveRoom();
  } else {
    joined = true;
    byId('status').textContent = 'Você entrou na prévia da sala.';
  }
  renderVoice();
});

async function startCapture(kind) {
  const session = roomSession;
  pending = true;
  renderVoice();
  try {
    const stream = kind === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({video: true, audio: preferences.screenAudio})
      : await navigator.mediaDevices.getUserMedia({audio: {
        noiseSuppression: preferences.noiseSuppression,
        echoCancellation: preferences.echoCancellation,
      }});
    if (session !== roomSession) {
      stopStream(stream);
      return;
    }
    if (kind === 'screen') {
      display = stream;
      byId('screen').srcObject = stream;
      byId('screen').hidden = false;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (display !== stream) return;
        stopSharing();
        byId('status').textContent = 'Compartilhamento encerrado.';
        renderVoice();
      });
      byId('status').textContent = 'Sua tela está visível nesta prévia local.';
    } else {
      microphone = stream;
      byId('status').textContent = 'Microfone ativo nesta prévia local.';
    }
  } catch {
    if (session === roomSession) {
      byId('status').textContent = kind === 'screen'
        ? 'Não foi possível compartilhar. Confira se o navegador permite capturar a tela.'
        : 'Não foi possível ativar o microfone. Confira a permissão no navegador.';
    }
  } finally {
    pending = false;
    renderVoice();
  }
}

byId('mic').addEventListener('click', () => {
  if (!microphone) return startCapture('mic');
  stopStream(microphone);
  microphone = undefined;
  byId('status').textContent = 'Microfone silenciado.';
  renderVoice();
});
byId('share').addEventListener('click', () => {
  if (!display) return startCapture('screen');
  stopSharing();
  byId('status').textContent = 'Compartilhamento encerrado.';
  renderVoice();
});
byId('composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = byId('message');
  const message = input.value.trim();
  if (!message) return;
  const time = new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
  textChannels[activeText].push([preferences.name, 'mint', time, message]);
  save();
  input.value = '';
  renderMessages();
});
byId('menu').addEventListener('click', () => {
  const open = document.querySelector('.sidebar').classList.toggle('open');
  byId('menu').setAttribute('aria-expanded', String(open));
});

function renderMembers() {
  byId('member-count').textContent = `${members.length + 1} NO ESPAÇO LOCAL`;
  const list = byId('members');
  list.replaceChildren();
  for (const member of members) {
    const person = document.createElement('div');
    const avatar = document.createElement('span');
    const details = document.createElement('div');
    const name = document.createElement('strong');
    const status = document.createElement('small');
    person.className = 'person';
    avatar.className = 'avatar lilac';
    avatar.textContent = member.name[0].toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');
    name.textContent = member.name;
    status.textContent = member.status;
    details.append(name, status);
    person.append(avatar, details);
    list.append(person);
  }
}

const panel = byId('panel');
const panelForm = byId('panel-form');
byId('close-panel').addEventListener('click', () => panel.close());

function openPanel(title, content, submit) {
  byId('settings-nav').hidden = true;
  byId('panel-title').textContent = title;
  panelForm.innerHTML = `${content}<p id="panel-status" role="status"></p>`;
  panelForm.onsubmit = (event) => {
    event.preventDefault();
    submit();
  };
  if (!panel.open) panel.showModal();
}

function panelStatus(message) {
  byId('panel-status').textContent = message;
}

function applyChanges() {
  const persisted = save();
  render();
  if (persisted) panel.close();
  else panelStatus('Alterações aplicadas nesta sessão. O navegador bloqueou o armazenamento local.');
}

function openChannelPanel(kind) {
  const text = kind === 'text';
  openPanel(`Novo canal de ${text ? 'texto' : 'voz'}`, `
    <label>Nome do canal<input id="channel-name" maxlength="32" required autofocus></label>
    ${text ? '' : '<p>Capacidade de 10 pessoas por sala.</p>'}
    <button class="primary" type="submit">Criar canal</button>`, () => {
    const label = byId('channel-name').value.trim().replace(/\s+/g, ' ');
    const name = text ? label.toLocaleLowerCase('pt-BR').replace(/\s+/g, '-') : label;
    if (!/[\p{L}\p{N}]/u.test(name)) return panelStatus('Digite um nome com letras ou números.');
    const names = text ? Object.keys(textChannels) : voiceRooms;
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      return panelStatus('Já existe um canal com esse nome.');
    }
    if (text) {
      textChannels[name] = [];
      activeText = name;
    } else {
      leaveRoom();
      voiceRooms.push(name);
      activeVoice = name;
    }
    viewingVoice = !text;
    renderChannels();
    applyChanges();
  });
}

const settingsSections = {
  profile: ['Perfil', `
    <label>Nome de exibição<input data-setting="name" maxlength="32"></label>
    <label>Iniciais ou símbolo do avatar<input data-setting="avatar" maxlength="6" placeholder="Usar a inicial do nome"></label>
    <label>Formato do avatar<select data-setting="avatarShape"><option value="square">Quadrado</option><option value="round">Redondo</option></select></label>
    <label>Sobre mim<textarea data-setting="bio" maxlength="100" rows="2"></textarea></label>
    <label>Status<select data-setting="status"><option value="available">Disponível</option><option value="away">Ausente</option><option value="busy">Não perturbe</option></select></label>`],
  appearance: ['Aparência', `
    <label>Espaçamento das mensagens<select data-setting="density"><option value="comfortable">Confortável</option><option value="compact">Compacto</option></select></label>
    <label>Tamanho do texto das mensagens<select data-setting="textSize"><option value="standard">Padrão</option><option value="large">Grande</option></select></label>`],
  voice: ['Voz e tela', `
    <label class="check-setting"><input data-setting="noiseSuppression" type="checkbox"> Redução de ruído do microfone</label>
    <label class="check-setting"><input data-setting="echoCancellation" type="checkbox"> Cancelamento de eco</label>
    <label class="check-setting"><input data-setting="screenAudio" type="checkbox"> Solicitar áudio ao compartilhar a tela</label>
    <p>As preferências de voz se aplicam na próxima captura, conforme o suporte do navegador.</p>`],
  server: ['Servidor', `
    <label>Nome da comunidade<input data-setting="workspace" maxlength="40"></label>
    <label>Descrição<input data-setting="description" maxlength="80"></label>
    <label>Símbolo do servidor<select data-setting="symbol"><option>✳</option><option>◆</option><option>✦</option><option>⬡</option></select></label>
    <label>Fundo do cartão de voz<select data-setting="roomStyle"><option value="grid">Listrado</option><option value="plain">Liso</option></select></label>
    <label>Canal de texto inicial<select data-setting="defaultChannel"></select></label>
    <label>Mensagem de boas-vindas no canal inicial<textarea data-setting="welcome" rows="3" maxlength="240"></textarea></label>`],
};

byId('settings').addEventListener('click', () => {
  const sections = Object.entries(settingsSections);
  const nav = byId('settings-nav');
  const bodies = sections.map(([key, [label, fields]]) =>
    `<fieldset id="settings-${key}" hidden><legend>${label}</legend>${fields}</fieldset>`);

  function selectSection(key) {
    for (const button of nav.children) {
      const current = button.dataset.section === key;
      button.setAttribute('aria-pressed', String(current));
      byId(`settings-${button.dataset.section}`).hidden = !current;
    }
  }

  openPanel('Configurações', `${bodies.join('')}<button class="primary" type="submit">Salvar configurações</button>`, () => {
    const draft = {};
    for (const field of fields) {
      draft[field.dataset.setting] = field.type === 'checkbox' ? field.checked : field.value.trim();
    }
    if (!draft.name || !draft.workspace) {
      const missing = draft.name ? 'workspace' : 'name';
      selectSection(draft.name ? 'server' : 'profile');
      panelStatus('Preencha o nome de exibição e o nome da comunidade.');
      fields.find((field) => field.dataset.setting === missing).focus();
      return;
    }
    Object.assign(preferences, draft);
    applyChanges();
  });

  const fields = Array.from(panelForm.querySelectorAll('[data-setting]'));
  const channelSelect = fields.find((field) => field.dataset.setting === 'defaultChannel');
  for (const name of Object.keys(textChannels)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = `# ${name}`;
    channelSelect.append(option);
  }
  for (const field of fields) {
    const value = preferences[field.dataset.setting];
    if (field.type === 'checkbox') field.checked = value;
    else field.value = field === channelSelect && !Object.hasOwn(textChannels, value) ? activeText : value;
  }

  nav.replaceChildren();
  for (const [key, [label]] of sections) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.section = key;
    button.textContent = label;
    button.addEventListener('click', () => selectSection(key));
    nav.append(button);
  }
  nav.hidden = false;
  selectSection('profile');
  nav.firstElementChild.focus();
});

byId('invite').addEventListener('click', () => {
  openPanel('Convidar membro', `
    <label>Nome do convidado<input id="invite-name" maxlength="32" required autofocus></label>
    <p>O convidado fica pendente nesta prévia. Copie a mensagem para enviar pelo seu app de mensagens.</p>
    <button class="primary" type="submit">Preparar convite</button>`, () => {
    const name = byId('invite-name').value.trim();
    if (!name) return panelStatus('Digite o nome do convidado.');
    const exists = members.some((member) => member.name.toLowerCase() === name.toLowerCase());
    if (!exists) members.push({name, status: 'Convite pendente'});
    const persisted = save();
    renderMembers();
    openPanel('Convite preparado', `
      <label>Mensagem para compartilhar<textarea id="invite-message" rows="4" readonly autofocus></textarea></label>
      <button class="primary" type="submit">Copiar mensagem</button>`, async () => {
      const message = byId('invite-message');
      try {
        await navigator.clipboard.writeText(message.value);
        panelStatus('Mensagem copiada.');
      } catch {
        message.select();
        panelStatus('Mensagem selecionada. Use o comando de copiar do navegador.');
      }
    });
    byId('invite-message').value = `Oi, ${name}! Estou montando a comunidade ${preferences.workspace}. Quer participar quando ela estiver disponível?`;
    if (!persisted) panelStatus('O navegador bloqueou o armazenamento. O convite fica apenas nesta sessão.');
  });
});

renderChannels();
render();
