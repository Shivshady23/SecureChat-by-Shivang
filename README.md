# 🔒 SecureChat - End-to-End Encrypted Messaging

A modern, WhatsApp-like messaging application built from scratch with React, Node.js, and Socket.io. Features real-time communication, end-to-end encryption for direct messages, and a beautiful, intuitive UI.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-green)

## ✨ Key Features

### Core Messaging
- 💬 **1-on-1 Messaging** - Private encrypted conversations
- 👥 **Group Chats** - Multi-user group conversations  
- 📱 **Chat Requests** - Secure chat initiation with accept/reject
- 🔐 **End-to-End Encryption** - ECDH key derivation + AES-256-GCM encryption for direct messages

### Real-time Features
- ✓ **Message Status** - Sent (✓) and Read (✓✓) indicators
- 🎤 **Typing Indicators** - See when someone is typing
- 🟢 **User Presence** - Online/offline status with real-time updates
- 📡 **WebSocket Communication** - Instant message delivery via Socket.io

### File Sharing
- 📎 **Secure File Upload** - Share images, documents, and files
- 🔐 **Encrypted Attachments** - Files encrypted in direct messages
- ⬇️ **One-click Download** - Auto-decrypt on download

### UX/UI
- 🎨 **WhatsApp-Inspired Design** - Modern, clean, intuitive interface
- 🔍 **Contact & Chat Search** - Quickly find chats and contacts
- 😊 **Emoji Support** - Quick emoji picker in message composer
- 📱 **Responsive Design** - Works on desktop and tablet
- 🎯 **Tabbed Navigation** - Separate Messages and Contacts tabs

## 🔒 Security Highlights

- **End-to-End Encryption**: 1-on-1 messages encrypted with shared key derived via ECDH
- **Public Key Cryptography**: RSA key pair generated and stored locally on registration
- **Secure Password Storage**: Passwords hashed with bcrypt
- **JWT Authentication**: Token-based API authentication
- **No Server Decryption**: Server can't read encrypted messages
- **HTTPS Ready**: Built for production with CORS and security headers

## 🏗️ Architecture

### Backend
```
Node.js + Express.js
├── MongoDB (Data Storage)
├── Socket.io (Real-time)
├── JWT (Authentication)
└── Multer (File Upload)
```

### Frontend
```
React 18 + React Scripts
├── React Router (Navigation)
├── Socket.io Client (Real-time)
├── Web Crypto API (Encryption)
└── Component-based UI
```

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- MongoDB (local or Atlas)
- npm/yarn

### 5-Minute Setup

```bash
# Backend
cd backend
npm install
cat > .env << EOF
PORT=5000
MONGO_URI=mongodb://localhost:27017/secure-chat
JWT_SECRET=your-secret-key
CLIENT_ORIGIN=http://localhost:3000
EOF
npm start

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Visit `http://localhost:3000` and start messaging!

👉 **See [QUICKSTART.md](./QUICKSTART.md) for detailed setup steps**

## 📚 Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** - Get running in 5 minutes
- **[IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)** - Complete technical documentation
- **[API Endpoints](#api-endpoints)** - REST API reference

## 🎯 Use Cases

- Private team messaging
- Family group chats
- Secure business communication
- End-to-end encrypted conversations
- File sharing between team members

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18, React Scripts, Socket.io |
| Backend | Node.js, Express, MongoDB |
| Authentication | JWT, bcrypt |
| Encryption | Web Crypto API, ECDH, AES-256-GCM |
| Real-time | Socket.io, WebSocket |
| Styling | CSS3, WhatsApp Design System |

## 📋 Project Structure

```
secure-chat/
├── backend/
│   ├── src/
│   │   ├── index.js
│   │   ├── models/ (User, Chat, Message, ChatRequest)
│   │   ├── routes/ (auth, users, chats, messages, upload)
│   │   ├── middleware/ (auth.js)
│   │   └── socket/ (real-time communication)
│   └── uploads/ (file storage)
├── frontend/
│   ├── src/
│   │   ├── pages/ (Chat, Login, Register)
│   │   ├── components/ (Sidebar, MessageList, ChatHeader, etc.)
│   │   ├── services/ (API, Socket, Storage)
│   │   ├── utils/ (Crypto functions)
│   │   └── styles-whatsapp.css
│   ├── public/
│   │   └── index.html
│   └── package.json
└── README.md
```

## 🔗 API Endpoints

### Authentication
```
POST   /api/auth/register       # Create new account
POST   /api/auth/login          # Login user
```

### Messages
```
GET    /api/messages/:chatId    # Get chat messages
POST   /api/messages/:chatId    # Send message
POST   /api/messages/:chatId/read  # Mark as read
```

### Chats
```
GET    /api/chats               # Get user chats
POST   /api/chats/group         # Create group
```

### Requests
```
GET    /api/requests            # Get pending requests
POST   /api/requests            # Send request
POST   /api/requests/:id/respond # Accept/reject
```

### Upload
```
POST   /api/upload              # Upload file
GET    /api/upload/:fileKey     # Download file
```

## 🔐 Encryption Workflow

### Direct Message Encryption
1. User A clicks "Send Message" to User B
2. Generate shared key using: ECDH(A's private key, B's public key)
3. Encrypt message with AES-256-GCM using shared key
4. Send encrypted message + IV to server
5. User B receives encrypted message
6. User B decrypts using: ECDH(B's private key, A's public key) = same shared key
7. Message decrypted in user's browser

### Group Messages
- Stored encrypted server-side (enhancement possible with group key management)

## 🎨 UI Features

- Clean, modern interface inspired by WhatsApp
- Dark mode compatible colors
- Smooth animations and transitions
- Responsive layout (desktop optimized, mobile friendly)
- Emoji picker integration
- File upload drag-and-drop support
- Modal dialogs for group creation
- Real-time presence indicators

## 🧪 Testing

### Create Test Accounts
1. Register user "alice" and user "bob"
2. Send chat request from alice to bob
3. Accept request from bob's side
4. Start messaging!

### Test File Sharing
1. Open chat with user
2. Click 📎 icon
3. Select an image or PDF
4. File encrypts and uploads
5. Other user downloads with auto-decryption

### Test Online Status
1. Open in two browser windows
2. See "Active now" status
3. Close window - status changes to offline
4. Real-time update via Socket.io

## ⚙️ Configuration

### Backend Environment Variables
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/secure-chat
JWT_SECRET=your-super-secret-key
CLIENT_ORIGIN=http://localhost:3000
```

### Frontend Environment Variables
```env
REACT_APP_API_BASE=http://localhost:5000
REACT_APP_SOCKET_URL=http://localhost:5000
```

## 🚀 Deployment

### Frontend
- **Vercel**: `git push` automatically deploys
- **Netlify**: Connect GitHub repo, set build command
- **GitHub Pages**: Run `npm run build` and deploy `build/`

### Backend
- **Railway**: Push to Git, Railway auto-detects
- **Render**: Connect repository, set start command
- **Heroku**: Use Procfile, set env variables

## 📊 Performance

- Messages are paginated for large chats
- User list cached client-side
- Real-time updates via WebSocket (lower latency than polling)
- File size limit: 2MB (configurable)
- Optimized React component rendering

## 🐛 Troubleshooting

**Can't connect to MongoDB?**
- Ensure MongoDB is running: `mongosh`
- Check MONGO_URI is correct
- Verify database exists

**Port already in use?**
```bash
lsof -i :5000
kill -9 <PID>
```

**Module not found errors?**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Encryption not working?**
- Use modern browser (Chrome, Firefox, Safari, Edge)
- Check browser supports Web Crypto API
- Clear browser cache

## 🛣️ Roadmap

- [ ] Message search
- [ ] Message reactions (👍 🎉 ❤️)
- [ ] Voice messages
- [ ] Message scheduling
- [ ] User avatars/profile pictures
- [ ] Push notifications
- [ ] Dark mode toggle
- [ ] 2FA authentication
- [ ] Message forwarding
- [ ] Pin messages

## 🤝 Contributing

Contributions welcome! Please:

1. Fork repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## ⚖️ Disclaimer

This is an educational project demonstrating messaging and encryption concepts. For production use:

- Use established messaging protocols
- Implement proper key management
- Enable HTTPS/TLS
- Regular security audits
- Comply with data protection regulations

## 📞 Support

- 📧 Open an issue for bug reports
- 💬 Start a discussion for feature requests
- 📖 Check [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for documentation

## 🙏 Acknowledgments

Built with inspiration from WhatsApp's excellent UX and modern security practices.

---

**Start secure, private messaging today! 🚀**
5. `npm run dev`

### Frontend
1. `cd frontend`
2. `cp .env.example .env`
3. Set:
   - `REACT_APP_API_BASE=http://localhost:5000`
   - `REACT_APP_SOCKET_URL=http://localhost:5000`
4. `npm install`
5. `npm run dev`

## Deploy
### Backend on Render
1. Create a new Web Service from the `backend/` directory.
2. Build command: `npm install`
3. Start command: `npm start`
4. Set environment variables:
   - `MONGO_URI`
   - `JWT_SECRET`
   - `CLIENT_ORIGIN` to your GitHub Pages URL

### MongoDB Atlas
1. Use your cluster connection string in `MONGO_URI`.
2. Make sure your Render IPs are allowed or set to `0.0.0.0/0`.

### Frontend on GitHub Pages
1. In `frontend/.env`, set:
   - `REACT_APP_API_BASE` to your Render backend URL
   - `REACT_APP_SOCKET_URL` to your Render backend URL
2. Build: `npm run build`
3. Deploy `frontend/build` to GitHub Pages.

## Limitations
- No OTP verification.
- E2E encryption is only for 1-1 chats.
- Not production-hardened.
