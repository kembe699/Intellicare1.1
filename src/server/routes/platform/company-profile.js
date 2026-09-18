const express = require('express');
const { CompanyProfile } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');

const router = express.Router();
router.use(authenticatePlatformAdmin);

// Singleton row, id fixed at 1 — created with its model defaults (including
// company_name) on first read so the settings form always has something to
// show, and every quotation always has a profile to render against.
async function getOrCreateProfile() {
  const [profile] = await CompanyProfile.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
  return profile;
}

router.get('/', async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    res.json(profile);
  } catch (error) {
    console.error('Get company profile error:', error);
    res.status(500).json({ error: 'Failed to load company profile' });
  }
});

router.put('/', async (req, res) => {
  try {
    const profile = await getOrCreateProfile();
    const { company_name, address, city, phone, email, website, logo, stamp, bank_name, bank_account_name, bank_account_number, bank_swift } = req.body;
    await profile.update({
      ...(company_name !== undefined ? { company_name: company_name.trim() || profile.company_name } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(city !== undefined ? { city } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(website !== undefined ? { website } : {}),
      ...(logo !== undefined ? { logo } : {}),
      ...(stamp !== undefined ? { stamp } : {}),
      ...(bank_name !== undefined ? { bank_name } : {}),
      ...(bank_account_name !== undefined ? { bank_account_name } : {}),
      ...(bank_account_number !== undefined ? { bank_account_number } : {}),
      ...(bank_swift !== undefined ? { bank_swift } : {}),
    });
    res.json(profile);
  } catch (error) {
    console.error('Update company profile error:', error);
    res.status(500).json({ error: error.message?.includes('too long') ? 'Logo image is too large' : 'Failed to update company profile' });
  }
});

module.exports = router;
