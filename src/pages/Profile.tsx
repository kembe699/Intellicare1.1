import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { authFetch } from '@/api/apiClient';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { UserRole } from '@/types';
import { 
  User, 
  Edit, 
  Check,
  X,
  Loader2,
  Shield,
  Mail,
  Building,
  Calendar,
  Key,
  Eye,
  EyeOff,
  PenTool,
  Upload,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/lib/notify';

const Profile: React.FC = () => {
  const { user, updateUser } = useAuth();
  const facilityInfo = useFacilityInfo();
  const [loading, setLoading] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signatureMode, setSignatureMode] = useState<'draw' | 'upload'>('draw');
  const [signature, setSignature] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Edit profile form state
  const [editFormData, setEditFormData] = useState({
    displayName: user?.displayName || '',
  });

  // Change password form state
  const [passwordFormData, setPasswordFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const handleEditProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!user) return;

    setSaving(true);
    
    try {
      const response = await authFetch(`/api/users/${user.uid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          displayName: editFormData.displayName.trim()
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update profile');
      }
        
      // Reflect the change immediately rather than waiting for the next page
      // load — the header and the profile card both read from this context.
      updateUser({ displayName: editFormData.displayName.trim() });
      toast.success('Profile updated successfully');
      setShowEditForm(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!user) return;

    if (passwordFormData.newPassword !== passwordFormData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    
    if (passwordFormData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }
    
    setSaving(true);
    
    try {
      // No Authorization header here. authFetch attaches the session token
      // itself, reading it from 'auth_token'; this read 'token', which does not
      // exist, and then sent "Bearer null" — and because the caller's headers are
      // spread over authFetch's, that null won. Every attempt came back 401 and
      // the form reported the session had expired, on a session that was fine.
      const response = await authFetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: passwordFormData.currentPassword,
          newPassword: passwordFormData.newPassword
        }),
      });

      if (!response.ok) {
        // The API reports failures on `error`, not `message`, so "Current
        // password is incorrect" was being swallowed and shown as a generic
        // failure — leaving no way to tell a wrong password from a broken form.
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.message || 'Failed to change password');
      }
      
      toast.success('Password changed successfully');
      setShowPasswordForm(false);
      setPasswordFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (error: any) {
      console.error('Error changing password:', error);
      toast.error(error.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  // Signature functions
  const handleSignatureUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setSignature(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        toast.error('Please upload an image file');
      }
    }
  };

  const clearSignature = () => {
    setSignature(null);
  };

  const saveSignature = async () => {
    if (saving) return;
    if (!signature || !user) return;

    setSaving(true);
    try {
      const response = await authFetch(`/api/users/${user.uid}/signature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ signature }),
      });

      if (!response.ok) {
        throw new Error('Failed to save signature');
      }

      toast.success('Signature saved successfully');
      setShowSignatureModal(false);
    } catch (error) {
      console.error('Error saving signature:', error);
      toast.error('Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  // Load existing signature
  useEffect(() => {
    const loadSignature = async () => {
      if (!user) return;
      
      try {
        const response = await authFetch(`/api/users/${user.uid}/signature`, {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          setSignature(data.signature);
        }
      } catch (error) {
        console.error('Error loading signature:', error);
      }
    };

    loadSignature();
  }, [user]);

  const getRoleBadgeColor = (role: UserRole) => {
    const colors = {
      admin: 'bg-red-100 text-red-800',
      doctor: 'bg-primary/10 text-primary',
      reception: 'bg-green-100 text-green-800',
      lab: 'bg-purple-100 text-purple-800',
      pharmacy: 'bg-orange-100 text-orange-800',
      reports: 'bg-muted text-foreground'
    };
    return colors[role] || 'bg-muted text-foreground';
  };

  const getRoleLabel = (role: UserRole) => {
    const labels = {
      admin: 'Administrator',
      doctor: 'Doctor',
      reception: 'Reception',
      lab: 'Laboratory',
      pharmacy: 'Pharmacy',
      reports: 'Reports'
    };
    return labels[role] || role;
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="animate-fade-in w-full flex flex-col">
        <PageHeader
          title="My Profile"
          actions={
            <Button onClick={() => setShowEditForm(true)}>
              <Edit className="w-5 h-5 mr-2" />Edit Profile
            </Button>
          }
        />

        {/* Profile Information */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Personal Information Card */}
          <div className="bg-card rounded-xl border shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <User className="w-5 h-5" />
              Personal Information
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">
                    {user?.displayName?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold">{user?.displayName}</h3>
                  <p className="text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-4 pt-4">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Email Address</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Role</p>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(user?.role || 'admin')}`}>
                      {getRoleLabel(user?.role || 'admin')}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Building className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Clinic</p>
                    {/* user.clinic is the clinic's id, so this rendered a bare
                        number ("6"). The facility's name is what a person
                        recognises. */}
                    <p className="text-sm text-muted-foreground">{facilityInfo.facilityName}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Account Security Card */}
          <div className="bg-card rounded-xl border shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Account Security
            </h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Password</p>
                    <p className="text-sm text-muted-foreground">••••••••</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPasswordForm(true)}
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Change
                  </Button>
                </div>
              </div>
              
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-medium text-green-800">Account Status</p>
                </div>
                <p className="text-sm text-green-700 mt-1">Your account is active and secure</p>
              </div>
            </div>
          </div>

          {/* Electronic Signature Card */}
          <div className="bg-card rounded-xl border shadow-sm p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <PenTool className="w-5 h-5" />
              Electronic Signature
            </h2>
            
            <div className="space-y-4">
              {signature ? (
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium">Current Signature</p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowSignatureModal(true)}
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearSignature}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="bg-white border rounded-lg p-4 max-w-md">
                    <img 
                      src={signature} 
                      alt="Electronic Signature" 
                      className="max-w-full h-auto max-h-24"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="text-center">
                    <PenTool className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="font-medium mb-2">No signature added</p>
                    <p className="text-sm text-muted-foreground mb-4">
                      Add your electronic signature to use in documents and approvals
                    </p>
                    <Button onClick={() => setShowSignatureModal(true)}>
                      <PenTool className="w-4 h-4 mr-2" />
                      Add Signature
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Edit Profile Modal */}
        <Dialog open={showEditForm} onOpenChange={setShowEditForm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="w-5 h-5" />
                Edit Profile
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleEditProfile} className="px-5 py-4 space-y-4 mt-4">
              <div className="form-field">
                <Label htmlFor="displayName" className="form-label">
                  Full Name *
                </Label>
                <Input
                  id="displayName"
                  value={editFormData.displayName}
                  onChange={(e) => setEditFormData({ ...editFormData, displayName: e.target.value })}
                  placeholder="Enter your full name"
                  required
                  autoFocus
                  className="h-12"
                />
              </div>

              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong>Note:</strong> Email, role, and clinic can only be changed by an administrator.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditForm(false)}
                  className="flex-1"
                  disabled={saving}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={saving || !editFormData.displayName.trim()}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Electronic Signature Modal */}
        <Dialog open={showSignatureModal} onOpenChange={setShowSignatureModal}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PenTool className="w-5 h-5" />
                Electronic Signature
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 mt-4">
              {/* Mode Selection */}
              <div className="flex gap-2 p-1 bg-muted rounded-lg">
                <Button
                  type="button"
                  variant={signatureMode === 'draw' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setSignatureMode('draw')}
                  className="flex-1"
                >
                  <PenTool className="w-4 h-4 mr-2" />
                  Draw
                </Button>
                <Button
                  type="button"
                  variant={signatureMode === 'upload' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setSignatureMode('upload')}
                  className="flex-1"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </Button>
              </div>

              {/* Drawing Mode */}
              {signatureMode === 'draw' && (
                <div className="space-y-4">
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-3">
                      Draw your signature in the area below:
                    </p>
                    <canvas
                      id="signatureCanvas"
                      width="600"
                      height="200"
                      className="border border-border rounded-lg bg-white cursor-crosshair w-full"
                      style={{ maxWidth: '100%', height: 'auto' }}
                      onMouseDown={(e) => {
                        setIsDrawing(true);
                        const canvas = e.currentTarget;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          const rect = canvas.getBoundingClientRect();
                          ctx.beginPath();
                          ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
                        }
                      }}
                      onMouseMove={(e) => {
                        if (!isDrawing) return;
                        const canvas = e.currentTarget;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          const rect = canvas.getBoundingClientRect();
                          ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
                          ctx.stroke();
                        }
                      }}
                      onMouseUp={() => {
                        setIsDrawing(false);
                        const canvas = document.getElementById('signatureCanvas') as HTMLCanvasElement;
                        if (canvas) {
                          setSignature(canvas.toDataURL());
                        }
                      }}
                      onMouseLeave={() => setIsDrawing(false)}
                    />
                    <div className="flex gap-2 mt-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const canvas = document.getElementById('signatureCanvas') as HTMLCanvasElement;
                          if (canvas) {
                            const ctx = canvas.getContext('2d');
                            if (ctx) {
                              ctx.clearRect(0, 0, canvas.width, canvas.height);
                              setSignature(null);
                            }
                          }
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload Mode */}
              {signatureMode === 'upload' && (
                <div className="space-y-4">
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-3">
                      Upload an image of your signature (PNG, JPG, or GIF):
                    </p>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleSignatureUpload}
                      className="h-12"
                    />
                  </div>
                </div>
              )}

              {/* Preview */}
              {signature && (
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="text-sm font-medium mb-3">Preview:</p>
                  <div className="bg-white border rounded-lg p-4 max-w-md">
                    <img 
                      src={signature} 
                      alt="Signature Preview" 
                      className="max-w-full h-auto max-h-24"
                    />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowSignatureModal(false);
                    setSignature(null);
                  }}
                  className="flex-1"
                  disabled={saving}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={saveSignature}
                  className="flex-1"
                  disabled={saving || !signature}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  {saving ? 'Saving...' : 'Save Signature'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Change Password Modal */}
        <Dialog open={showPasswordForm} onOpenChange={setShowPasswordForm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Change Password
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleChangePassword} className="px-5 py-4 space-y-4 mt-4">
              <div className="form-field">
                <Label htmlFor="currentPassword" className="form-label">
                  Current Password *
                </Label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showCurrentPassword ? "text" : "password"}
                    value={passwordFormData.currentPassword}
                    onChange={(e) => setPasswordFormData({ ...passwordFormData, currentPassword: e.target.value })}
                    placeholder="Enter current password"
                    required
                    autoFocus
                    className="h-12 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="form-field">
                <Label htmlFor="newPassword" className="form-label">
                  New Password *
                </Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPassword ? "text" : "password"}
                    value={passwordFormData.newPassword}
                    onChange={(e) => setPasswordFormData({ ...passwordFormData, newPassword: e.target.value })}
                    placeholder="Enter new password"
                    required
                    minLength={6}
                    className="h-12 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="form-field">
                <Label htmlFor="confirmPassword" className="form-label">
                  Confirm New Password *
                </Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={passwordFormData.confirmPassword}
                    onChange={(e) => setPasswordFormData({ ...passwordFormData, confirmPassword: e.target.value })}
                    placeholder="Confirm new password"
                    required
                    minLength={6}
                    className="h-12 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setPasswordFormData({
                      currentPassword: '',
                      newPassword: '',
                      confirmPassword: ''
                    });
                  }}
                  className="flex-1"
                  disabled={saving}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={saving || !passwordFormData.currentPassword || !passwordFormData.newPassword || !passwordFormData.confirmPassword}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4 mr-2" />
                  )}
                  {saving ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </AppLayout>
  );
};

export default Profile;
