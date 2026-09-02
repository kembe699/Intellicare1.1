// Minimal login endpoint for Vercel deployment
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, password } = req.body;

    // For now, return a mock successful login response
    // In production, this would validate against a database
    if (email && password) {
      // Mock user data
      const mockUser = {
        id: '1',
        email: email,
        display_name: 'Demo User',
        role: 'admin',
        clinic_id: '1',
        branchId: '1'
      };

      // Mock JWT token (in production, use proper JWT signing)
      const mockToken = 'demo_token_' + Date.now();

      res.status(200).json({
        success: true,
        user: mockUser,
        token: mockToken,
        message: 'Login successful (demo mode)'
      });
    } else {
      res.status(400).json({
        error: 'Email and password are required'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
