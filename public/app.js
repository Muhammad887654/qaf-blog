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

        function setStatus(element,message){
          element.textContent=message;
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
          setStatus(profileStatus,'');
          try{
            await renderPosts();
            setStatus(accountStatus,'Masuk sebagai '+user.email+'.');
          }catch(error){
            setStatus(accountStatus,error.message||'Tulisan tidak dapat dimuat.');
          }
        }

        profileForm.addEventListener('submit',async function(event){
          event.preventDefault();
          if(!currentUser) return;
          var formData=new FormData(profileForm);
          try{
            var result=await apiRequest('/api/profile',{
              method:'PATCH',
              body:JSON.stringify({
                displayName:formData.get('displayName'),
                bio:formData.get('bio')
              })
            });
            currentUser=result.user;
            document.getElementById('profile-email').textContent=currentUser.email;
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

        apiRequest('/api/me')
          .then(function(result){return showAccount(result.user);})
          .catch(function(error){
            setStatus(loginStatus,error.message||'Backend tidak dapat dihubungi. Jalankan server terlebih dahulu.');
          });
      })();
