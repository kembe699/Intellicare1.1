# IntelliCare HMIS - Production Setup Guide

## System Configuration

### ✅ Production-Ready Features Implemented

1. **CORS Configuration**
   - Server accepts connections from ALL IP addresses
   - Configured with `origin: true` to allow any origin
   - Credentials enabled for authentication

2. **Network Configuration**
   - Server listens on `0.0.0.0:3001` (all network interfaces)
   - Accepts connections from any IP address on the network
   - Dynamic API URL configuration in frontend

3. **Frontend API Configuration**
   - Automatically detects server IP address
   - Uses `window.location.hostname` to connect to backend
   - Works on localhost and any network IP

## Deployment Instructions

### 1. Server Setup

The server is already configured to accept connections from all networks.

**Start the server:**
```bash
cd /home/universal-hospital/development/server
node index.js
```

The server will start on port 3001 and accept connections from any IP address.

### 2. Frontend Setup

The frontend is configured to automatically connect to the backend using the current hostname.

**Start the frontend:**
```bash
cd /home/universal-hospital/development
npm run dev
```

The frontend will start on port 8080 (or configured port).

### 3. Network Access

#### Access from Local Machine:
- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:3001`

#### Access from Other Devices on Network:
- Frontend: `http://<SERVER_IP>:8080`
- Backend API: `http://<SERVER_IP>:3001`

Replace `<SERVER_IP>` with your server's IP address (e.g., `192.168.1.100`)

### 4. Find Your Server IP Address

**Linux:**
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

**Or:**
```bash
hostname -I
```

### 5. Firewall Configuration

Make sure ports 3001 and 8080 are open:

```bash
# Ubuntu/Debian
sudo ufw allow 3001
sudo ufw allow 8080

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

## Database Configuration

The system uses MySQL database with the following configuration:
- Host: localhost
- Database: universal_hmis
- User: root
- Port: 3306

**Important:** For production, consider:
1. Creating a dedicated database user (not root)
2. Using strong passwords
3. Restricting database access to localhost only

## Security Considerations

### Current Configuration (Development/Internal Network):
- ✅ CORS allows all origins
- ✅ Server accepts all network connections
- ✅ Suitable for internal hospital network

### For Internet-Facing Production:
Consider implementing:
1. **HTTPS/SSL** - Use reverse proxy (nginx/Apache) with SSL certificates
2. **Firewall Rules** - Restrict access to specific IP ranges
3. **Database Security** - Use dedicated user with limited privileges
4. **Environment Variables** - Store sensitive data securely
5. **Rate Limiting** - Prevent API abuse
6. **Authentication** - Already implemented, ensure strong passwords

## Testing Network Access

### From Another Device:

1. **Find server IP:**
   ```bash
   hostname -I
   ```

2. **Access frontend from another device:**
   ```
   http://<SERVER_IP>:8080
   ```

3. **Test API endpoint:**
   ```bash
   curl http://<SERVER_IP>:3001/health
   ```

   Should return:
   ```json
   {"status":"healthy","uptime":123.456}
   ```

## Troubleshooting

### Cannot Connect from Other Devices:

1. **Check firewall:**
   ```bash
   sudo ufw status
   ```

2. **Verify server is listening on all interfaces:**
   ```bash
   netstat -tlnp | grep 3001
   ```
   Should show `0.0.0.0:3001`

3. **Check if ports are accessible:**
   ```bash
   # From another device
   telnet <SERVER_IP> 3001
   telnet <SERVER_IP> 8080
   ```

### CORS Errors:

The server is configured to accept all origins. If you still see CORS errors:
1. Clear browser cache
2. Check browser console for specific error
3. Verify server is running

## Production Checklist

- [x] CORS configured for all origins
- [x] Server listens on 0.0.0.0
- [x] Dynamic API URL configuration
- [x] Database connection working
- [x] All API endpoints functional
- [ ] SSL/HTTPS configured (if internet-facing)
- [ ] Firewall rules configured
- [ ] Database user with limited privileges
- [ ] Regular backups configured
- [ ] Monitoring and logging setup

## System Requirements

- Node.js 14+ 
- MySQL 5.7+
- 2GB RAM minimum
- 10GB disk space minimum

## Support

For issues or questions, refer to the application logs:
- Server logs: Check terminal where `node index.js` is running
- Frontend logs: Check browser console (F12)
