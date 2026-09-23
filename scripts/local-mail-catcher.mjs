// Local development SMTP inbox. Binds loopback only and never relays mail externally.
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const directory = path.join(process.env.LOCALAPPDATA, 'UnifiedTreeRecovery', 'mail')
fs.mkdirSync(directory, { recursive: true })
const smtp = net.createServer(socket => {
  let buffer = '', lines = [], data = false, size = 0
  socket.setTimeout(30000, () => socket.destroy())
  socket.write('220 UnifiedTree local inbox\r\n')
  socket.on('error', () => {})
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8')
    if (buffer.length + size > 15 * 1024 * 1024) { socket.end('552 Message too large\r\n'); return }
    let end
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
      if (data) {
        if (line === '.') {
          const id = randomUUID()
          try {
            fs.writeFileSync(path.join(directory, id + '.eml'), lines.join('\r\n'), 'utf8')
            socket.write('250 Captured locally ' + id + '\r\n')
          } catch { socket.write('451 Cannot persist message\r\n') }
          data = false; lines = []; size = 0
        } else { const unstuffed = line.startsWith('..') ? line.slice(1) : line; lines.push(unstuffed); size += unstuffed.length }
      } else if (/^(EHLO|HELO) /i.test(line)) socket.write('250-localhost\r\n250 SIZE 15728640\r\n')
      else if (/^(MAIL FROM:|RCPT TO:|RSET|NOOP)/i.test(line)) socket.write('250 OK\r\n')
      else if (/^DATA$/i.test(line)) { data = true; socket.write('354 End with a single dot\r\n') }
      else if (/^QUIT$/i.test(line)) socket.end('221 Bye\r\n')
      else socket.write('502 Unsupported command\r\n')
    }
  })
})
smtp.listen(11025, '127.0.0.1')
const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  const files = fs.readdirSync(directory).filter(x => /^[a-f0-9-]{36}\.eml$/.test(x))
  const messages = files.map(file => {
    const raw = fs.readFileSync(path.join(directory, file), 'utf8')
    return { id: file.slice(0, -4), to: raw.match(/^To: (.*)$/m)?.[1]?.trim() || '', subject: raw.match(/^Subject: (.*)$/m)?.[1]?.trim() || '', receivedAt: fs.statSync(path.join(directory, file)).mtime.toISOString() }
  }).sort((a,b) => b.receivedAt.localeCompare(a.receivedAt))
  if (request.url === '/messages') { response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(messages)); return }
  const match = request.url?.match(/^\/messages\/([a-f0-9-]{36})$/)
  if (match && files.includes(match[1] + '.eml')) { response.setHeader('Content-Type','text/plain; charset=utf-8'); response.end(fs.readFileSync(path.join(directory, match[1] + '.eml'))); return }
  if (request.url === '/') {
    response.setHeader('Content-Type','text/html; charset=utf-8')
    response.end('<!doctype html><title>UnifiedTree local inbox</title><h1>Local development inbox</h1><p>Messages are stored on this computer. Nothing is sent externally.</p><ul>' + messages.map(m => `<li><a href="/messages/${m.id}">${escape(m.subject)}</a> — ${escape(m.to)} (${m.receivedAt})</li>`).join('') + '</ul>'); return
  }
  response.statusCode = 404; response.end('Not found')
}).listen(18025, '127.0.0.1')
