export function findMagnet(group,actors,joints,threshold){
  let found;
  for(const joint of joints){
    const a=actors.get(joint.a).group,b=actors.get(joint.b).group;
    if(a===b||(a!==group&&b!==group))continue;
    const other=a===group?b:a,delta=Math.hypot(group.dx-other.dx,group.dy-other.dy);
    if(delta<=threshold&&(!found||delta<found.delta))found={other,joint,delta};
  }
  return found;
}

export function joinGroups(group,other,actors,groups){
  group.dx=other.dx;group.dy=other.dy;
  for(const id of other.members){group.members.add(id);actors.get(id).group=group;}
  groups.delete(other);
}
