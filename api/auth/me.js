// User profile endpoint for Vercel deployment
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Check for authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Mock user data (in production, validate token and fetch from database)
    const mockUser = {
      id: '1',
      email: 'demo@intellicare.com',
      display_name: 'Demo User',
      role: 'admin',
      clinic_id: '1',
      branchId: '1'
    };

    res.status(200).json(mockUser);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
