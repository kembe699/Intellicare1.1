// Create or update visit
router.post('/visits', async (req, res) => {
  try {
    const visitData = req.body;
    console.log('Saving visit with data:', visitData);
    console.log('Vitals data received:', visitData.vitals);
    
    let visit;
    let isUpdate = false;
    
    // Check if a visit already exists for this queue entry
    if (visitData.queue_id) {
      const queueEntry = await PatientQueue.findByPk(visitData.queue_id);
      console.log('Queue entry found:', queueEntry ? queueEntry.id : 'none');
      console.log('Queue entry visit_id:', queueEntry ? queueEntry.visit_id : 'none');
      
      if (queueEntry && queueEntry.visit_id) {
        // Visit already exists, update it
        isUpdate = true;
        console.log('UPDATING existing visit:', queueEntry.visit_id);
        await Visit.update(visitData, {
          where: { id: queueEntry.visit_id }
        });
        visit = await Visit.findByPk(queueEntry.visit_id);
        console.log('Visit UPDATED successfully:', visit.id);
      } else {
        // No existing visit, create new one
        console.log('CREATING new visit (queue has no visit_id)');
        visit = await Visit.create(visitData);
        console.log('Visit CREATED successfully:', visit.id);
        
        // Update queue entry with visit_id
        if (queueEntry) {
          await PatientQueue.update(
            { visit_id: visit.id },
            { where: { id: visitData.queue_id } }
          );
          console.log('Updated queue entry with visit_id:', visit.id);
        }
      }
      
      // Update patient queue status to 'in_progress'
      try {
        await PatientQueue.update(
          { status: 'in_progress' },
          { where: { id: visitData.queue_id } }
        );
        console.log('Updated queue status to in_progress for queue ID:', visitData.queue_id);
      } catch (queueError) {
        console.error('Error updating queue status:', queueError);
      }
    } else {
      // No queue_id, create new visit
      console.log('CREATING new visit (no queue_id provided)');
      visit = await Visit.create(visitData);
      console.log('Visit CREATED successfully:', visit.id);
    }
    
    console.log('Visit vitals saved:', visit.vitals);
    
    // Add lab tests to existing patient bill if lab requests exist
    if (visitData.lab_requests && visitData.lab_requests.length > 0) {
      try {
        await addLabTestsToExistingBill(visitData);
      } catch (billError) {
        console.error('Error adding lab tests to bill:', billError);
      }
    }
    
    res.json(visit);
  } catch (error) {
    console.error('Error saving visit:', error);
    res.status(500).json({ error: 'Failed to save visit' });
  }
});
