(function(){
        var loginForm=document.getElementById('login-form');
        var postForm=document.getElementById('post-form');
        var profileForm=document.getElementById('profile-form');
        var loginStatus=document.getElementById('login-status');
        var accountStatus=document.getElementById('account-status');
        var profileStatus=document.getElementById('profile-status');
        var accountView=document.getElementById('account-view');
        var postsContainer=document.getElementById('my-posts');
        var currentUser=null;
        var registrationMode=false;
        var pendingAvatar;
        var dailyQuotes=[
          'Ilmu yang mendekatkan kita pada kebaikan bukan hanya untuk disimpan, tetapi untuk diamalkan dan dibagikan.',
          'Langkah kecil yang dijaga dengan niat baik dapat membuka jalan bagi perubahan besar.',
          'Belajar dengan rendah hati, berbuat dengan tulus, dan bertumbuh bersama.'
        ];

        function setStatus(element,message){
          element.textContent=message;
        }

        function renderDailyQuote(){
          var today=new Date();
          var year=today.getFullYear();
          var month=today.getMonth();
          var day=today.getDate();
          var dayNumber=Math.floor(Date.UTC(year,month,day)/86400000);
          document.getElementById('daily-quote-text').textContent=dailyQuotes[dayNumber%dailyQuotes.length];
          document.getElementById('daily-quote-author').textContent='Refleksi QAF';
          document.getElementById('daily-quote-date').textContent=today.toLocaleDateString('id-ID',{
            day:'numeric',
            month:'long',
            year:'numeric'
          });
        }

        function renderAvatar(avatar,displayName,email){
          var image=document.getElementById('profile-avatar-image');
          var initials=document.getElementById('profile-avatar-initials');
          initials.textContent=(displayName||email||'?').trim().slice(0,1).toUpperCase();
          image.hidden=!avatar;
          if(avatar) image.src=avatar;
          else image.removeAttribute('src');
        }

        async function apiRequest(path,options){
          var response=await fetch(path,Object.assign({
            headers:{'Content-Type':'application/json'},
            credentials:'same-origin'
          },options||{}));
          var result=await response.json();
          if(!response.ok) throw new Error(result.error||'Permintaan tidak berhasil.');
          return result;
        }

        async function renderPosts(){
          var result=await apiRequest('/api/posts');
          postsContainer.replaceChildren();
          if(result.posts.length===0){
            var empty=document.createElement('p');
            empty.className='lead';
            empty.textContent='Belum ada tulisan. Buat tulisan pertama Anda di formulir atas.';
            postsContainer.appendChild(empty);
            return;
          }
          result.posts.forEach(function(post){
            var article=document.createElement('article');
            var tag=document.createElement('span');
            var title=document.createElement('h3');
            var content=document.createElement('p');
            var date=document.createElement('p');
            tag.className='tag';
            tag.textContent=post.category;
            title.textContent=post.title;
            content.textContent=post.content;
            date.className='meta';
            date.textContent=new Date(post.createdAt).toLocaleString('id-ID');
            article.append(tag,title,content,date);
            postsContainer.appendChild(article);
          });
        }

        async function showAccount(user){
          currentUser=user;
          loginForm.hidden=!!user;
          accountView.hidden=!user;
          setStatus(loginStatus,'');
          if(!user) return;
          setStatus(accountStatus,'Masuk sebagai '+user.email+'. Memuat tulisan...');
          document.getElementById('profile-email').textContent=user.email;
          document.getElementById('profile-name').value=user.displayName||user.email.split('@')[0];
          document.getElementById('profile-bio').value=user.bio||'';
          document.getElementById('profile-avatar-file').value='';
          pendingAvatar=undefined;
          renderAvatar(user.avatar,user.displayName,user.email);
          setStatus(profileStatus,'');
          try{
            await renderPosts();
            setStatus(accountStatus,'Masuk sebagai '+user.email+'.');
          }catch(error){
            setStatus(accountStatus,error.message||'Tulisan tidak dapat dimuat.');
          }
        }

        document.getElementById('profile-avatar-file').addEventListener('change',function(event){
          var file=event.target.files[0];
          if(!file) return;
          if(!['image/png','image/jpeg','image/webp'].includes(file.type)){
            event.target.value='';
            setStatus(profileStatus,'Pilih gambar PNG, JPEG, atau WebP.');
            return;
          }
          if(file.size>2*1024*1024){
            event.target.value='';
            setStatus(profileStatus,'Ukuran foto maksimal 2 MB.');
            return;
          }
          var reader=new FileReader();
          reader.addEventListener('load',function(){
            pendingAvatar=reader.result;
            renderAvatar(pendingAvatar,document.getElementById('profile-name').value,currentUser.email);
            setStatus(profileStatus,'Pratinjau foto siap. Simpan profil untuk menerapkan perubahan.');
          });
          reader.addEventListener('error',function(){
            event.target.value='';
            setStatus(profileStatus,'Foto tidak dapat dibaca. Coba pilih file lain.');
          });
          reader.readAsDataURL(file);
        });

        document.getElementById('remove-avatar').addEventListener('click',function(){
          if(!currentUser) return;
          pendingAvatar=null;
          document.getElementById('profile-avatar-file').value='';
          renderAvatar(null,document.getElementById('profile-name').value,currentUser.email);
          setStatus(profileStatus,'Foto akan dihapus setelah profil disimpan.');
        });

        profileForm.addEventListener('submit',async function(event){
          event.preventDefault();
          if(!currentUser) return;
          var formData=new FormData(profileForm);
          try{
            var result=await apiRequest('/api/profile',{
              method:'PATCH',
              body:JSON.stringify({
                displayName:formData.get('displayName'),
                bio:formData.get('bio'),
                avatar:pendingAvatar===undefined?currentUser.avatar:pendingAvatar
              })
            });
            currentUser=result.user;
            document.getElementById('profile-email').textContent=currentUser.email;
            pendingAvatar=undefined;
            renderAvatar(currentUser.avatar,currentUser.displayName,currentUser.email);
            document.getElementById('profile-avatar-file').value='';
            setStatus(profileStatus,'Profil berhasil disimpan.');
          }catch(error){
            setStatus(profileStatus,error.message||'Profil tidak dapat disimpan.');
          }
        });

        document.getElementById('register-button').addEventListener('click',function(){
          registrationMode=!registrationMode;
          document.getElementById('login-submit').textContent=registrationMode?'Daftar':'Masuk';
          document.getElementById('register-button').textContent=registrationMode?'Kembali ke login':'Buat akun baru';
          document.getElementById('login-password').autocomplete=registrationMode?'new-password':'current-password';
          setStatus(loginStatus,registrationMode?'Kata sandi minimal 10 karakter.':'');
        });

        loginForm.addEventListener('submit',async function(event){
          event.preventDefault();
          var email=document.getElementById('login-email').value.trim().toLowerCase();
          var password=document.getElementById('login-password').value;
          try{
            var result=await apiRequest(registrationMode?'/api/register':'/api/login',{
              method:'POST',
              body:JSON.stringify({email:email,password:password})
            });
            document.getElementById('login-password').value='';
            loginForm.reset();
            registrationMode=false;
            document.getElementById('login-submit').textContent='Masuk';
            document.getElementById('register-button').textContent='Buat akun baru';
            await showAccount(result.user);
          }catch(error){
            setStatus(loginStatus,error.message||'Tidak dapat masuk ke server.');
          }
        });

        postForm.addEventListener('submit',async function(event){
          event.preventDefault();
          if(!currentUser) return;
          var formData=new FormData(postForm);
          try{
            await apiRequest('/api/posts',{
              method:'POST',
              body:JSON.stringify({
                title:formData.get('title'),
                category:formData.get('category'),
                content:formData.get('content')
              })
            });
            postForm.reset();
            setStatus(accountStatus,'Tulisan berhasil disimpan.');
            await renderPosts();
          }catch(error){
            setStatus(accountStatus,error.message||'Tulisan tidak dapat disimpan.');
          }
        });

        document.getElementById('logout-button').addEventListener('click',async function(){
          try{
            await apiRequest('/api/logout',{method:'POST',body:'{}'});
            await showAccount(null);
            setStatus(loginStatus,'Anda telah keluar.');
          }catch(error){
            setStatus(accountStatus,error.message||'Tidak dapat keluar dari akun.');
          }
        });

        document.querySelectorAll('.tabs button').forEach(function(button){
          button.addEventListener('click',function(){
            document.querySelectorAll('.tabs button').forEach(function(tab){
              tab.setAttribute('aria-pressed',String(tab===button));
            });
            var category=button.dataset.k;
            document.querySelectorAll('#tulisan article').forEach(function(article){
              article.hidden=!(category==='semua'||article.dataset.k===category);
            });
          });
        });

        renderDailyQuote();
        apiRequest('/api/me')
          .then(function(result){return showAccount(result.user);})
          .catch(function(error){
            setStatus(loginStatus,error.message||'Backend tidak dapat dihubungi. Jalankan server terlebih dahulu.');
          });
      })();
